import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockQueryFn: () => Promise<{ data: unknown; error: unknown }>;

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        limit: () => mockQueryFn(),
      }),
    }),
  }),
}));

vi.mock("@/lib/observability/log", () => ({
  logError: vi.fn(),
}));

import { GET } from "./route";

beforeEach(() => {
  mockQueryFn = async () => ({ data: [{ id: "acc-1" }], error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/health", () => {
  it("returns 200 ok when database check succeeds", async () => {
    mockQueryFn = async () => ({ data: [{ id: "acc-1" }], error: null });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.checks.database).toBe(true);
  });

  it("returns 503 error when database query returns an error", async () => {
    mockQueryFn = async () => ({
      data: null,
      error: { message: "connection refused" },
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe("error");
    expect(data.checks.database).toBe(false);
  });

  it("returns 503 error instead of hanging when database query times out", async () => {
    // Simulate a database query that hangs indefinitely
    mockQueryFn = () => new Promise(() => {});

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe("error");
    expect(data.checks.database).toBe(false);
  }, 10000);
});
