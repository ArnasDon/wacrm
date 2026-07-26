import { sanitizeDebugValue } from "./debug-runtime";
import { boundDebugExecutionPayload } from "./execution-payload";

const SUMMARY_FIELDS = [
  "id",
  "node_key",
  "node_type",
  "status",
  "attempt",
  "duration_ms",
  "created_at",
] as const;

const DETAIL_FIELDS = [
  ["inputs", "object"],
  ["outputs", "object"],
  ["error", "object"],
  ["simulated_effects", "array"],
  ["metadata", "object"],
] as const;

function requiredString(
  execution: Record<string, unknown>,
  field: "id" | "node_key" | "node_type" | "status",
): string {
  const value = execution[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("invalid_debug_execution");
  }
  return value;
}

function requiredAttempt(execution: Record<string, unknown>): number {
  const value = execution.attempt;
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error("invalid_debug_execution");
  }
  return value as number;
}

export function sanitizeDebugExecutionSummary(
  execution: Record<string, unknown>,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    id: requiredString(execution, "id"),
    node_key: requiredString(execution, "node_key"),
    node_type: requiredString(execution, "node_type"),
    status: requiredString(execution, "status"),
    attempt: requiredAttempt(execution),
  };
  for (const field of SUMMARY_FIELDS) {
    if (field in summary || execution[field] === undefined) continue;
    summary[field] = sanitizeDebugValue(execution[field]);
  }
  return summary;
}

export function sanitizeDebugExecutionDetail(
  execution: Record<string, unknown>,
): Record<string, unknown> {
  const detail = sanitizeDebugExecutionSummary(execution);
  for (const [field, shape] of DETAIL_FIELDS) {
    detail[field] = sanitizeDebugValue(
      boundDebugExecutionPayload(execution[field] ?? null, shape),
    );
  }
  return detail;
}
