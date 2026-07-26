import type { FlowVariableDeclaration } from "@/lib/flows/runtime-primitives";

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

export async function fetchDebugSessions(
  fetcher: Fetcher,
  flowId: string,
): Promise<DebugSessionSummary[]> {
  const response = await fetcher(`/api/flows/${flowId}/debug/sessions`, {
    cache: "no-store",
  });
  const body = await readResponse<{ sessions?: DebugSessionSummary[] }>(
    response,
  );
  return body.sessions ?? [];
}

export async function resumeDebugSession(
  fetcher: Fetcher,
  flowId: string,
  sessionId: string,
): Promise<{ session: DebugSession; executions: DebugExecution[] }> {
  const response = await fetcher(
    `/api/flows/${flowId}/debug/sessions/${sessionId}`,
    { cache: "no-store" },
  );
  return readResponse(response);
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
  return readResponse(response);
}
