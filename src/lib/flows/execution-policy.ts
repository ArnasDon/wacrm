import type {
  NodeExecutionPolicy,
  PartialNodeExecutionPolicy,
} from "./registry";
import { sanitizeHttpHeaders } from "./http-request";

export const DEFAULT_NODE_EXECUTION_POLICY: NodeExecutionPolicy = {
  retry: {
    max_attempts: 1,
    interval_ms: 0,
    backoff: "fixed",
  },
  on_error: "fail_run",
  timeout_ms: 15_000,
};

export class NonRetryableExecutionError extends Error {
  readonly retryable = false;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NonRetryableExecutionError";
  }
}

export class CommittedSideEffectError extends NonRetryableExecutionError {
  readonly sideEffectCommitted = true;

  constructor(
    message: string,
    readonly metadata: {
      externalReference: string;
      persistenceStage: string;
      cause?: unknown;
      effectId?: string;
      operationId?: string;
      effectKind?: string;
      remoteResult?: unknown;
      expectedNodeKey?: string;
      expectedVisitId?: string;
      expectedContinuationId?: string | null;
      intendedNextNodeKey?: string;
      intendedNextVisitId?: string;
    },
  ) {
    super(message, { cause: metadata.cause });
    this.name = "CommittedSideEffectError";
  }

  get externalReference(): string {
    return this.metadata.externalReference;
  }

  get persistenceStage(): string {
    return this.metadata.persistenceStage;
  }
}

export class NodeExecutionTimeoutError extends NonRetryableExecutionError {
  constructor(timeoutMs: number) {
    super(`Node execution timed out after ${timeoutMs}ms`);
    this.name = "NodeExecutionTimeoutError";
  }
}

export class NodeExecutionExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    options: { cause: unknown },
  ) {
    super(`Node execution failed after ${attempts} attempt(s)`, options);
    this.name = "NodeExecutionExhaustedError";
  }
}

export interface ExecuteNodePolicyHooks<T> {
  now?: () => number;
  signal?: AbortSignal;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  onAttemptStart?: (attempt: number, startedAtMs: number) => Promise<void>;
  onAttemptSuccess?: (
    attempt: number,
    value: T,
    durationMs: number,
  ) => Promise<void>;
  onAttemptError?: (
    attempt: number,
    error: unknown,
    durationMs: number,
  ) => Promise<void>;
}

function defaultSleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function safeHook(callback: (() => Promise<void>) | undefined) {
  if (!callback) return;
  try {
    await callback();
  } catch (error) {
    console.error(
      "[flows] execution observability hook failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function isNonRetryable(error: unknown): boolean {
  return (
    error instanceof NonRetryableExecutionError ||
    (typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      (error as { retryable?: unknown }).retryable === false)
  );
}

export function isCommittedSideEffectError(error: unknown): boolean {
  if (error instanceof CommittedSideEffectError) return true;
  return (
    error instanceof Error &&
    "cause" in error &&
    error.cause !== undefined &&
    isCommittedSideEffectError(error.cause)
  );
}

async function runTimedAttempt<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new NodeExecutionTimeoutError(timeoutMs);
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function executeWithNodePolicy<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  policy: NodeExecutionPolicy,
  hooks: ExecuteNodePolicyHooks<T> = {},
): Promise<{ value: T; attempts: number }> {
  const now = hooks.now ?? Date.now;
  const sleep = hooks.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.retry.max_attempts; attempt += 1) {
    const startedAt = now();
    await safeHook(
      () => hooks.onAttemptStart?.(attempt, startedAt) ?? Promise.resolve(),
    );
    try {
      const value = await runTimedAttempt(operation, policy.timeout_ms);
      await safeHook(
        () =>
          hooks.onAttemptSuccess?.(attempt, value, now() - startedAt) ??
          Promise.resolve(),
      );
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      await safeHook(
        () =>
          hooks.onAttemptError?.(attempt, error, now() - startedAt) ??
          Promise.resolve(),
      );
      if (isNonRetryable(error) || attempt >= policy.retry.max_attempts) {
        throw new NodeExecutionExhaustedError(attempt, { cause: error });
      }
      const multiplier =
        policy.retry.backoff === "exponential" ? 2 ** (attempt - 1) : 1;
      await sleep(
        Math.min(policy.retry.interval_ms * multiplier, 10_000),
        hooks.signal,
      );
    }
  }

  throw new NodeExecutionExhaustedError(policy.retry.max_attempts, {
    cause: lastError,
  });
}

export function resolveNodeExecutionPolicy(
  globalPolicy: PartialNodeExecutionPolicy | undefined,
  nodeConfig: Record<string, unknown>,
): NodeExecutionPolicy {
  const nodePolicy = nodeConfig as PartialNodeExecutionPolicy;
  const onError =
    nodePolicy.on_error ??
    globalPolicy?.on_error ??
    DEFAULT_NODE_EXECUTION_POLICY.on_error;
  const resolved: NodeExecutionPolicy = {
    retry:
      nodePolicy.retry ??
      globalPolicy?.retry ??
      DEFAULT_NODE_EXECUTION_POLICY.retry,
    on_error: onError,
    timeout_ms:
      nodePolicy.timeout_ms ??
      globalPolicy?.timeout_ms ??
      DEFAULT_NODE_EXECUTION_POLICY.timeout_ms,
  };

  if (onError === "fail_branch") {
    resolved.error_next_node_key =
      nodePolicy.error_next_node_key ?? globalPolicy?.error_next_node_key;
  } else if (onError === "default_value") {
    resolved.default_value =
      nodePolicy.default_value ?? globalPolicy?.default_value;
  }
  return resolved;
}

export type ExhaustedNodePolicyResolution =
  | { action: "fail_run" }
  | {
      action: "advance";
      nextNodeKey: string;
      vars: Record<string, unknown>;
    };

export function resolveExhaustedNodePolicy(
  policy: NodeExecutionPolicy,
  vars: Record<string, unknown>,
  normalSuccessNextNodeKey: string | undefined,
): ExhaustedNodePolicyResolution {
  if (policy.on_error === "fail_branch" && policy.error_next_node_key) {
    return {
      action: "advance",
      nextNodeKey: policy.error_next_node_key,
      vars,
    };
  }
  if (
    policy.on_error === "default_value" &&
    policy.default_value &&
    normalSuccessNextNodeKey
  ) {
    return {
      action: "advance",
      nextNodeKey: normalSuccessNextNodeKey,
      vars: {
        ...vars,
        [policy.default_value.key]: policy.default_value.value,
      },
    };
  }
  return { action: "fail_run" };
}

export function sanitizeExecutionError(
  error: unknown,
): Record<string, unknown> {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    return {
      name: error.name,
      message: error.message.slice(0, 500),
      ...(code ? { code } : {}),
      retryable: !isNonRetryable(error),
      ...(error instanceof CommittedSideEffectError
        ? {
            side_effect_committed: true,
            external_reference: error.externalReference.slice(0, 500),
            persistence_stage: error.persistenceStage.slice(0, 100),
          }
        : {}),
    };
  }
  return {
    name: "Error",
    message: String(error).slice(0, 500),
    retryable: true,
  };
}

export function sanitizeExecutionData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeExecutionData);
  if (!value || typeof value !== "object") {
    return typeof value === "string" && value.length > 2_000
      ? `${value.slice(0, 2_000)}...`
      : value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
      if (
        key.toLowerCase() === "headers" &&
        nested &&
        typeof nested === "object" &&
        !Array.isArray(nested)
      ) {
        const entries = Object.entries(nested as Record<string, unknown>);
        if (entries.every((entry) => typeof entry[1] === "string")) {
          return [
            key,
            sanitizeHttpHeaders(
              Object.fromEntries(entries) as Record<string, string>,
            ),
          ];
        }
      }
      return [
        key,
        /token|secret|password|authorization|cookie|api[_-]?key|credential|prompt|response|reply/i.test(
          key,
        )
          ? "[REDACTED]"
          : key === "url" && typeof nested === "string"
            ? sanitizeExecutionUrl(nested)
            : sanitizeExecutionData(nested),
      ];
    }),
  );
}

function sanitizeExecutionUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[REDACTED_URL]";
  }
}
