import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  createTelnyxClient,
  loadTelnyxApiKey,
  TelnyxApiError,
} from "./api"

describe("createTelnyxClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("dial envía payload correcto y mapea snake_case → camelCase", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          call_control_id: "cc-1",
          call_leg_id: "leg-1",
          call_session_id: "sess-1",
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = createTelnyxClient("test-key")
    const result = await client.dial({
      to: "+15550001111",
      from: "+15550002222",
      connectionId: "conn-1",
      webhookUrl: "https://app.example/api/telnyx/webhook",
    })

    expect(result).toEqual({
      callControlId: "cc-1",
      callLegId: "leg-1",
      callSessionId: "sess-1",
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.telnyx.com/v2/calls")
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe("Bearer test-key")
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      to: "+15550001111",
      from: "+15550002222",
      connection_id: "conn-1",
      webhook_url: "https://app.example/api/telnyx/webhook",
    })
  })

  it("sendSms envía el cuerpo esperado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: "msg-1" } }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = createTelnyxClient("test-key")
    const result = await client.sendSms({
      from: "+15550002222",
      to: "+15550003333",
      text: "Holaa",
      messagingProfileId: "profile-1",
    })

    expect(result).toEqual({ id: "msg-1" })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe("Bearer test-key")
    expect(JSON.parse(init.body)).toMatchObject({
      from: "+15550002222",
      to: "+15550003333",
      text: "Holaa",
      messaging_profile_id: "profile-1",
    })
  })

  it("lanza TelnyxApiError con el status cuando la API falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "forbidden",
      }),
    )

    const client = createTelnyxClient("bad-key")
    await expect(client.listPhoneNumbers()).rejects.toBeInstanceOf(TelnyxApiError)
    await expect(client.listPhoneNumbers()).rejects.toMatchObject({ status: 403 })
  })
})

describe("loadTelnyxApiKey", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.doMock("@/lib/telnyx/admin-client", () => ({
      supabaseAdmin: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { api_key_encrypted: "iv:cipher:tag" },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    }))
    vi.doMock("@/lib/whatsapp/encryption", () => ({
      decrypt: (s: string) => (s === "iv:cipher:tag" ? "decrypted-key" : "?"),
    }))
    vi.resetModules()
  })
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("lee la key encriptada de telnyx_config y la desencripta", async () => {
    const { loadTelnyxApiKey } = await import("./api")
    await expect(loadTelnyxApiKey("acct-1")).resolves.toBe("decrypted-key")
  })

  it("lanza TelnyxApiError cuando no hay config", async () => {
    vi.doMock("@/lib/telnyx/admin-client", () => ({
      supabaseAdmin: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }))
    vi.resetModules()
    const { loadTelnyxApiKey } = await import("./api")
    // resetModules() crea una nueva copia de la clase; validamos por nombre.
    await expect(loadTelnyxApiKey("acct-x")).rejects.toMatchObject({
      name: "TelnyxApiError",
    })
  })
})