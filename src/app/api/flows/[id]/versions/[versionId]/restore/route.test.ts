import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  version: null as Record<string, unknown> | null,
  ownerUserId: "user-1",
  restoreError: null as { message: string } | null,
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: h.requireRole,
  toErrorResponse: () =>
    Response.json({ error: "Forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => {
      if (table === "flows") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "flow-1",
                    user_id: h.ownerUserId,
                    draft_revision: 8,
                    published_version_id: "version-2",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "flow_versions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: h.version, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({ rpc: h.rpc }),
}));

import { POST } from "./route";

const context = {
  params: Promise.resolve({ id: "flow-1", versionId: "version-1" }),
};

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue(undefined);
  h.ownerUserId = "user-1";
  h.restoreError = null;
  h.version = {
    id: "version-1",
    flow_id: "flow-1",
    graph: {
      schema_version: 1,
      trigger: { type: "manual", config: {} },
      entry_node_key: "end",
      fallback_policy: {
        on_unknown_reply: "reprompt",
        max_reprompts: 2,
        on_timeout_hours: 24,
        on_exhaust: "handoff",
      },
      nodes: [
        {
          node_key: "end",
          node_type: "end",
          config: {},
          position_x: 0,
          position_y: 0,
        },
      ],
    },
  };
  h.rpc.mockImplementation(() =>
    Promise.resolve({
      data: h.restoreError
        ? null
        : [
            {
              id: "flow-1",
              published_version_id: "version-2",
              draft_revision: 9,
            },
          ],
      error: h.restoreError,
    }),
  );
});

describe("restore flow version API", () => {
  it("transactionally overwrites only the editable draft", async () => {
    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/versions/version-1/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_draft_revision: 8,
          expected_published_version_id: "version-2",
        }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("restore_flow_version", {
      p_flow_id: "flow-1",
      p_flow_version_id: "version-1",
      p_expected_draft_revision: 8,
      p_expected_published_version_id: "version-2",
    });
    expect(await response.json()).toMatchObject({
      restored_version_id: "version-1",
      flow: { published_version_id: "version-2" },
    });
  });

  it.each(["draft_revision_conflict", "published_version_conflict"])(
    "maps %s to a non-clobbering 409",
    async (message) => {
      h.restoreError = { message };
      const response = await POST(
        new Request("http://localhost/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_draft_revision: 8,
            expected_published_version_id: "version-2",
          }),
        }),
        context,
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: expect.stringMatching(/refresh|retry/i),
      });
    },
  );

  it("fails closed before restore when the stored graph is corrupt", async () => {
    h.version = { id: "version-1", flow_id: "flow-1", graph: {} };

    const response = await POST(
      new Request("http://localhost/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_draft_revision: 8,
          expected_published_version_id: "version-2",
        }),
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("denies restore to a same-account non-owner", async () => {
    h.ownerUserId = "user-2";

    const response = await POST(
      new Request("http://localhost/restore", { method: "POST" }),
      context,
    );

    expect(response.status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
