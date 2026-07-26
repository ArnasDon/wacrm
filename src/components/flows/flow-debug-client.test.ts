import { describe, expect, it, vi } from "vitest";

import {
  closeDebugSessionAndRefresh,
  closeDebugSession,
  fetchDebugSessions,
  fetchFlightExecutionDetail,
  fetchFlightRecorder,
  recoverDebugSession,
  resumeDebugSession,
} from "./flow-debug-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("flow debug inspector client", () => {
  it("loads the session inventory and resumes a selected session", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          sessions: [
            { id: "session-a", revision: 3, status: "active" },
            { id: "session-b", revision: 1, status: "closed" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          session: {
            id: "session-a",
            revision: 3,
            status: "active",
            variables: {},
            manifest: { variable_schema: [], nodes: [] },
          },
          executions: [
            { id: "debug-1", node_key: "send", status: "completed" },
          ],
        }),
      );

    const sessions = await fetchDebugSessions(fetcher, "flow-a");
    const resumed = await resumeDebugSession(fetcher, "flow-a", "session-a");

    expect(sessions.map((session) => session.id)).toEqual([
      "session-a",
      "session-b",
    ]);
    expect(resumed.session.id).toBe("session-a");
    expect(resumed.executions[0]?.id).toBe("debug-1");
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/flows/flow-a/debug/sessions",
      { cache: "no-store" },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/flows/flow-a/debug/sessions/session-a",
      { cache: "no-store" },
    );
  });

  it("closes with optimistic concurrency so quota is recoverable without reload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        session: { id: "session-a", revision: 8, status: "closed" },
      }),
    );

    const closed = await closeDebugSession(fetcher, "flow-a", "session-a", 7);

    expect(closed).toMatchObject({
      id: "session-a",
      revision: 8,
      status: "closed",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/flows/flow-a/debug/sessions/session-a",
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_revision: 7 }),
      },
    );
  });

  it("filters production attempts through run_id and forwards pagination", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        runs: [{ id: "run-a", status: "completed" }],
        executions: [],
        latest_by_run: {},
        page: {
          limit: 25,
          returned: 0,
          truncated: false,
          next_cursor: null,
        },
      }),
    );

    await fetchFlightRecorder(fetcher, "flow-a", {
      runId: "run a",
      cursor: "2026-01-01T00:00:00.000Z",
      limit: 25,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/flows/flow-a/debug/flight-recorder?run_id=run+a&cursor=2026-01-01T00%3A00%3A00.000Z&limit=25",
      { cache: "no-store" },
    );
  });

  it("surfaces API errors instead of returning unusable empty state", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "debug_session_quota" }, 429));

    await expect(fetchDebugSessions(fetcher, "flow-a")).rejects.toThrow(
      "debug_session_quota",
    );
  });

  it("loads production IO lazily by execution id", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        execution: {
          id: "execution-a",
          node_key: "send",
          status: "completed",
          inputs: { text: "hello" },
          outputs: { sent: true },
          error: null,
        },
      }),
    );

    const execution = await fetchFlightExecutionDetail(
      fetcher,
      "flow-a",
      "execution-a",
    );

    expect(execution.outputs).toEqual({ sent: true });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/flows/flow-a/debug/flight-recorder/execution-a",
      { cache: "no-store" },
    );
  });

  it("clears an expired session and refreshes inventory after a 410", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { code: "DEBUG_SESSION_UNAVAILABLE", error: "Expired" },
          410,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          sessions: [{ id: "session-b", revision: 2, status: "active" }],
        }),
      );

    const result = await recoverDebugSession(fetcher, "flow-a", "session-a");

    expect(result).toEqual({
      outcome: "unavailable",
      sessions: [{ id: "session-b", revision: 2, status: "active" }],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refreshes the multi-tab inventory after a close revision conflict", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ code: "DEBUG_REVISION_CONFLICT", error: "Reload" }, 409),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          sessions: [{ id: "session-a", revision: 8, status: "active" }],
        }),
      );

    const result = await closeDebugSessionAndRefresh(
      fetcher,
      "flow-a",
      "session-a",
      7,
    );

    expect(result).toEqual({
      outcome: "conflict",
      sessions: [{ id: "session-a", revision: 8, status: "active" }],
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      expected_revision: 7,
    });
  });

  it("forwards the debug execution cursor when resuming more attempts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        session: {
          id: "session-a",
          revision: 1,
          status: "active",
          variables: {},
          manifest: { variable_schema: [], nodes: [] },
        },
        executions: [],
        page: { next_cursor: null, truncated: false },
      }),
    );

    await resumeDebugSession(fetcher, "flow-a", "session-a", {
      cursor: "opaque cursor",
      limit: 10,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/flows/flow-a/debug/sessions/session-a?cursor=opaque+cursor&limit=10",
      { cache: "no-store" },
    );
  });
});
