import { beforeEach, describe, expect, it, vi } from "vitest"

// POST /api/telnyx/token — emite login_token JWT para el softphone WebRTC.

const RANK: Record<string, number> = { viewer: 0, agent: 1, admin: 2, owner: 3 }

let credentialId: string | null = "cred-1"
let hasCred: boolean

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

vi.mock("@/lib/telnyx/api", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    TelnyxApiError: actual.TelnyxApiError,
    loadTelnyxApiKey: vi.fn(async () => "test-key"),
    ensureWebrtcCredential: vi.fn(async () => {
      if (!hasCred) throw new Error("Telnyx config not found for account")
      return credentialId as string
    }),
    createTelnyxClient: vi.fn(() => ({
      createWebrtcToken: vi.fn(async () => ({ token: "jwt-login-token" })),
      getTelephonyCredential: vi.fn(async () => ({
        id: "cred-1",
        sip_username: "gencredABC123",
        sip_password: "s3cret",
      })),
    })),
  }
})

import { POST } from "./route"

function post() {
  return POST(new Request("http://localhost/api/telnyx/token", { method: "POST" }) as never)
}

beforeEach(() => {
  hasCred = true
  credentialId = "cred-1"
})

describe("POST /api/telnyx/token", () => {
  it("devuelve token + sip credentials", async () => {
    const res = await post()
    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.token).toBe("jwt-login-token")
    expect(json.sip_username).toBe("gencredABC123")
    expect(json.credential_id).toBe("cred-1")
  })

  it("500 sin config de Telnyx", async () => {
    hasCred = false
    const res = await post()
    expect(res.status).toBe(500)
  })

  it("la api key de Telnyx nunca aparece en la respuesta", async () => {
    const res = await post()
    const json = (await res.json()) as Record<string, unknown>
    expect(JSON.stringify(json)).not.toContain("test-key")
  })
})