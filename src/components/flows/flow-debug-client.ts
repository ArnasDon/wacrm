import type { FlowVariableDeclaration } from "@/lib/flows/runtime-primitives";
import { z } from "zod";

export interface DebugManifestPort {
  id: string;
  label: string;
  type: string;
  cardinality: "one" | "many";
  required?: boolean;
}

export interface DebugManifestNode {
  node_key: string;
  node_type: string;
  label: string;
  inputs: DebugManifestPort[];
  outputs: DebugManifestPort[];
}

export interface DebugSessionSummary {
  id: string;
  revision: number;
  source_run_id?: string | null;
  status: string;
  updated_at?: string;
  expires_at?: string;
}

export interface DebugSession extends DebugSessionSummary {
  variables: Record<string, unknown>;
  manifest: {
    variable_schema: FlowVariableDeclaration[];
    nodes: DebugManifestNode[];
  };
}

export interface DebugExecution {
  id: string;
  flow_run_id?: string;
  node_key: string;
  node_type?: string;
  status: string;
  inputs?: unknown;
  outputs?: unknown;
  error?: unknown;
  simulated_effects?: unknown[];
  metadata?: unknown;
  duration_ms?: number;
  attempt?: number;
  started_at?: string;
}

export interface SourceRun {
  id: string;
  status: string;
  started_at?: string;
}

export interface FlightRecorderPage {
  limit: number;
  returned: number;
  truncated: boolean;
  truncation_reason: "page" | "budget" | null;
  next_cursor: string | null;
  budget_bytes: number;
}

export interface FlightRecorderResponse {
  runs: SourceRun[];
  executions: DebugExecution[];
  latest_by_run: Record<string, Record<string, DebugExecution>>;
  page: FlightRecorderPage;
}

type Fetcher = typeof fetch;

const debugExecutionSchema = z
  .object({
    id: z.string().min(1),
    node_key: z.string().min(1),
    node_type: z.string().min(1).optional(),
    status: z.string().min(1),
    inputs: z.unknown().optional(),
    outputs: z.unknown().optional(),
    error: z.unknown().optional(),
    simulated_effects: z.array(z.unknown()).optional(),
    metadata: z.unknown().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    attempt: z.number().int().positive().optional(),
    started_at: z.string().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

const debugRunExecutionSchema = debugExecutionSchema.extend({
  node_type: z.string().min(1),
  attempt: z.number().int().positive(),
});

const debugSessionSchema = z
  .object({
    id: z.string().min(1),
    revision: z.number().int().nonnegative(),
    status: z.string().min(1),
    variables: z.record(z.string(), z.unknown()),
    manifest: z.object({
      variable_schema: z.array(z.unknown()),
      nodes: z.array(z.unknown()),
    }),
  })
  .passthrough();

const debugSessionSummarySchema = z
  .object({
    id: z.string().min(1),
    revision: z.number().int().nonnegative(),
    source_run_id: z.string().min(1).nullable().optional(),
    status: z.string().min(1),
    updated_at: z.string().min(1).optional(),
    expires_at: z.string().min(1).optional(),
  })
  .passthrough();

const sourceRunSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    started_at: z.string().min(1).optional(),
  })
  .passthrough();

const flightRecorderPageSchema = z.object({
  limit: z.number().int().positive(),
  returned: z.number().int().nonnegative(),
  truncated: z.boolean(),
  truncation_reason: z.enum(["page", "budget"]).nullable(),
  next_cursor: z.string().min(1).nullable(),
  budget_bytes: z.number().int().positive(),
});

const flightRecorderResponseSchema = z.object({
  runs: z.array(sourceRunSchema),
  executions: z.array(debugExecutionSchema),
  latest_by_run: z.record(
    z.string(),
    z.record(z.string(), debugExecutionSchema),
  ),
  page: flightRecorderPageSchema,
});

export class FlowDebugClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FlowDebugClientError";
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new FlowDebugClientError(
      body.error ?? "Unable to load flow debug data",
      response.status,
    );
  }
  return body;
}

function invalidResponse(): FlowDebugClientError {
  return new FlowDebugClientError("Invalid flow debug response", 502);
}

function parseDebugExecution(value: unknown): DebugExecution {
  const parsed = debugExecutionSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data as DebugExecution;
}

function parseDebugRunExecution(value: unknown): DebugExecution {
  const parsed = debugRunExecutionSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data as DebugExecution;
}

function parseDebugSession(value: unknown): DebugSession {
  const parsed = debugSessionSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data as unknown as DebugSession;
}

export async function fetchDebugSessions(
  fetcher: Fetcher,
  flowId: string,
): Promise<DebugSessionSummary[]> {
  const response = await fetcher(`/api/flows/${flowId}/debug/sessions`, {
    cache: "no-store",
  });
  const body = await readResponse<unknown>(response);
  const parsed = z
    .object({ sessions: z.array(debugSessionSummarySchema) })
    .safeParse(body);
  if (!parsed.success) throw invalidResponse();
  return parsed.data.sessions as DebugSessionSummary[];
}

export async function resumeDebugSession(
  fetcher: Fetcher,
  flowId: string,
  sessionId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<{
  session: DebugSession;
  executions: DebugExecution[];
  page?: FlightRecorderPage;
}> {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetcher(
    `/api/flows/${flowId}/debug/sessions/${sessionId}${query}`,
    { cache: "no-store" },
  );
  const body = await readResponse<{
    session?: unknown;
    executions?: unknown[];
    page?: unknown;
  }>(response);
  if (!body.session || !Array.isArray(body.executions)) {
    throw invalidResponse();
  }
  const parsedPage =
    body.page === undefined
      ? null
      : flightRecorderPageSchema.safeParse(body.page);
  if (parsedPage && !parsedPage.success) throw invalidResponse();
  return {
    session: parseDebugSession(body.session),
    executions: body.executions.map(parseDebugExecution),
    ...(parsedPage?.success
      ? { page: parsedPage.data as FlightRecorderPage }
      : {}),
  };
}

export async function recoverDebugSession(
  fetcher: Fetcher,
  flowId: string,
  sessionId: string,
): Promise<
  | {
      outcome: "resumed";
      session: DebugSession;
      executions: DebugExecution[];
    }
  | { outcome: "unavailable"; sessions: DebugSessionSummary[] }
> {
  try {
    const resumed = await resumeDebugSession(fetcher, flowId, sessionId);
    return { outcome: "resumed", ...resumed };
  } catch (error) {
    if (
      error instanceof FlowDebugClientError &&
      (error.status === 404 || error.status === 410)
    ) {
      return {
        outcome: "unavailable",
        sessions: await fetchDebugSessions(fetcher, flowId),
      };
    }
    throw error;
  }
}

export async function closeDebugSession(
  fetcher: Fetcher,
  flowId: string,
  sessionId: string,
  expectedRevision: number,
): Promise<DebugSessionSummary> {
  const response = await fetcher(
    `/api/flows/${flowId}/debug/sessions/${sessionId}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected_revision: expectedRevision }),
    },
  );
  const body = await readResponse<{ session: DebugSessionSummary }>(response);
  return body.session;
}

export async function closeDebugSessionAndRefresh(
  fetcher: Fetcher,
  flowId: string,
  sessionId: string,
  expectedRevision: number,
): Promise<{
  outcome: "closed" | "conflict" | "unavailable";
  sessions: DebugSessionSummary[];
}> {
  let outcome: "closed" | "conflict" | "unavailable" = "closed";
  try {
    await closeDebugSession(fetcher, flowId, sessionId, expectedRevision);
  } catch (error) {
    if (!(error instanceof FlowDebugClientError)) throw error;
    if (error.status === 409) {
      outcome = "conflict";
    } else if (error.status === 404 || error.status === 410) {
      outcome = "unavailable";
    } else {
      throw error;
    }
  }
  return {
    outcome,
    sessions: await fetchDebugSessions(fetcher, flowId),
  };
}

export async function fetchFlightRecorder(
  fetcher: Fetcher,
  flowId: string,
  options: { runId?: string; cursor?: string; limit?: number } = {},
): Promise<FlightRecorderResponse> {
  const params = new URLSearchParams();
  if (options.runId) params.set("run_id", options.runId);
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  const response = await fetcher(
    `/api/flows/${flowId}/debug/flight-recorder${query}`,
    { cache: "no-store" },
  );
  const body = await readResponse<unknown>(response);
  const parsed = flightRecorderResponseSchema.safeParse(body);
  if (!parsed.success) throw invalidResponse();
  return parsed.data as FlightRecorderResponse;
}

export async function fetchFlightExecutionDetail(
  fetcher: Fetcher,
  flowId: string,
  executionId: string,
): Promise<DebugExecution> {
  const response = await fetcher(
    `/api/flows/${flowId}/debug/flight-recorder/${executionId}`,
    { cache: "no-store" },
  );
  const body = await readResponse<{ execution?: unknown }>(response);
  return parseDebugExecution(body.execution);
}

export async function fetchDebugExecutionDetail(
  fetcher: Fetcher,
  flowId: string,
  sessionId: string,
  executionId: string,
): Promise<DebugExecution> {
  const response = await fetcher(
    `/api/flows/${flowId}/debug/sessions/${sessionId}/executions/${executionId}`,
    { cache: "no-store" },
  );
  const body = await readResponse<{ execution?: unknown }>(response);
  return parseDebugRunExecution(body.execution);
}

export async function runDebugNode(
  fetcher: Fetcher,
  flowId: string,
  sessionId: string,
  nodeKey: string,
  input: {
    expectedRevision: number;
    overrides: Record<string, unknown>;
  },
): Promise<{ session: DebugSession; execution: DebugExecution }> {
  const response = await fetcher(
    `/api/flows/${flowId}/debug/sessions/${sessionId}/nodes/${encodeURIComponent(nodeKey)}/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_revision: input.expectedRevision,
        overrides: input.overrides,
      }),
    },
  );
  const body = await readResponse<{
    session?: unknown;
    execution?: unknown;
  }>(response);
  return {
    session: parseDebugSession(body.session),
    execution: parseDebugRunExecution(body.execution),
  };
}
