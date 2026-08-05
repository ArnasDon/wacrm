import { beforeEach, describe, expect, it, vi } from "vitest"

// GET /api/telnyx/recordings/[callId] — proxy autenticado (signed URL 5 min).

const RANK: Record<string, number> = { viewer: 0, agent: 1, admin: 2, owner: 3 }

let storagePath: string | null = "account-acct-1/1700000000000-recording.mp3"
let signedUrlOk = true

vi.mock("@/lib/auth/account", async (importOriginal) => {
  const actual = (await importOriginal()) as { ForbiddenError: new (m: string) => Error }
  return {
    ...actual,
    requireRole: vi.fn(async (min: string) => {
      if (RANK.agent < RANK[min]) throw new actual.ForbiddenError(`requires ${min}`)
      return { accountId: "acct-1", role: "agent", supabase: {}, account: { id: "acct-1", name: "Acme" } }
    }),
  }
})

vi.mock("@/lib/telnyx/admin-client", () => ({
  supabaseAdmin: vi.fn(() => {
    const storage = {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async (path: string, expire: number) =>
          signedUrlOk
            ? { data: { signedUrl: `https://x.supabase.co/storage/signed?path=${path}&e=${expire}` }, error: null }
            : { data: null, error: new Error("storage error") },
        ),
      })),
    }
    const db = {
      from: vi.fn((table: string) => {
        const b: Record<string, unknown> = {}
        b.select = vi.fn(() => b)
        b.eq = vi.fn(() => b)
        b.maybeSingle = vi.fn(async () =>
          table === "calls"
            ? { data: storagePath ? { recording_storage_path: storagePath } : null, error: null }
            : { data: null, error: null },
        )
        return b
      }),
    }
    return { ...db, storage }
  }),
}))

import { GET } from "./route"

function get() {
  return GET(new Request("http://localhost/api/telnyx/recordings/call-1") as never, {
    params: Promise.resolve({ callId: "call-1" }),
  })
}

beforeEach(() => {
  storagePath = "account-acct-1/1700000000000-recording.mp3"
  signedUrlOk = true
})

describe("GET /api/telnyx/recordings/[callId]", () => {
  it("redirige (302) a la signed URL de 5 min", async () => {
    const res = await get()
    expect(res.status).toBe(302)
    const loc = res.headers.get("location")
    expect(loc).toContain("account-acct-1/1700000000000-recording.mp3")
    expect(loc).toContain("e=300")
  })

  it("404 cuando la llamada no tiene grabación", async () => {
    storagePath = null
    const res = await get()
    expect(res.status).toBe(404)
  })

  it("500 cuando falla la firma del storage", async () => {
    signedUrlOk = false
    const res = await get()
    expect(res.status).toBe(500)
  })
})