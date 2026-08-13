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

  it("lookupNumber: GET /number_lookup/{number} con + URL-encoded (%2B)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          phone_number: "+15550001111",
          carrier: { name: "Telnyx Wireless" },
          line_type: "Wireless",
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = createTelnyxClient("test-key")
    const result = await client.lookupNumber("+15550001111")

    expect(result?.carrier).toEqual({ name: "Telnyx Wireless" })
    expect(result?.line_type).toBe("Wireless")
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(
      "https://api.telnyx.com/v2/number_lookup/%2B15550001111",
    )
  })

  it("lookupNumber: 4xx → null (no rompe el check)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "not found",
      }),
    )
    const client = createTelnyxClient("test-key")
    await expect(client.lookupNumber("+15550009999")).resolves.toBeNull()
  })

  it("getReputation: extrae reputation_data del response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          phone_number: "+15550001111",
          reputation_data: {
            spam_risk: "low",
            maturity_score: 72,
            connection_score: 80,
            engagement_score: 64,
          },
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = createTelnyxClient("test-key")
    const result = await client.getReputation("+15550001111")

    expect(result).toEqual({
      spam_risk: "low",
      maturity_score: 72,
      connection_score: 80,
      engagement_score: 64,
    })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(
      "https://api.telnyx.com/v2/reputation/phone_numbers/%2B15550001111",
    )
  })

  it("getReputation: 404 → null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "not found",
      }),
    )
    const client = createTelnyxClient("test-key")
    await expect(client.getReputation("+15550009999")).resolves.toBeNull()
  })

  it("createNumberOrder: POST /number_orders con config opcional", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: "order-1",
          status: "pending",
          phone_numbers_count: 1,
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    const client = createTelnyxClient("test-key")
    const result = await client.createNumberOrder({
      phoneNumber: "+15550004444",
      connectionId: "conn-1",
      messagingProfileId: "profile-1",
      customerReference: "wacrm-acct1234",
    })

    expect(result).toEqual({ id: "order-1", status: "pending", phoneNumbersCount: 1 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://api.telnyx.com/v2/number_orders")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toMatchObject({
      phone_numbers: [{ phone_number: "+15550004444" }],
      connection_id: "conn-1",
      messaging_profile_id: "profile-1",
      customer_reference: "wacrm-acct1234",
    })
  })

  it("listPhoneNumbers: pagina con page[number] siguiendo meta.total_pages", async () => {
    // Contrato real de Telnyx: GET /v2/phone_numbers recibe page[number]/
    // page[size] y responde meta: { total_pages, page_number, ... }.
    // (Antes el test mockeaba meta.next, que la API real nunca envía,
    // por eso el bug de paginación rota pasó como verde.)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: "n1", phone_number: "+15550000001" }],
          meta: { total_pages: 2, page_number: 1 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: "n2", phone_number: "+15550000002" }],
          meta: { total_pages: 2, page_number: 2 },
        }),
      })
    vi.stubGlobal("fetch", fetchMock)

    const client = createTelnyxClient("test-key")
    const result = await client.listPhoneNumbers()

    expect(result).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [firstUrl] = fetchMock.mock.calls[0]
    expect(firstUrl).toBe(
      "https://api.telnyx.com/v2/phone_numbers?page[size]=100&page[number]=1",
    )
    const [secondUrl] = fetchMock.mock.calls[1]
    expect(secondUrl).toContain("page[number]=2")
  })
})

describe("loadTelnyxApiKey", () => {
  /**
   * Registra el mock de admin-client para UN test y recarga el registro.
   *
   * Antes el caso "hay config" se registraba en el `beforeEach` y el caso
   * "no hay config" lo pisaba desde dentro del test: dos `doMock` sobre la
   * misma ruta compitiendo, y cuál ganaba dependía del orden en que vitest
   * resolvía el registro bajo carga en paralelo. El test de "no hay config"
   * fallaba de higos a brevas resolviendo "decrypted-key" en vez de
   * rechazar. Cada test registra ahora el suyo y solo el suyo.
   */
  function mockTelnyxConfigRow(row: { api_key_encrypted: string } | null) {
    vi.doMock("@/lib/telnyx/admin-client", () => ({
      supabaseAdmin: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: row, error: null }),
            }),
          }),
        }),
      }),
    }))
    vi.resetModules()
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.doMock("@/lib/whatsapp/encryption", () => ({
      decrypt: (s: string) => (s === "iv:cipher:tag" ? "decrypted-key" : "?"),
    }))
    vi.resetModules()
  })
  afterEach(() => {
    vi.doUnmock("@/lib/telnyx/admin-client")
    vi.doUnmock("@/lib/whatsapp/encryption")
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("lee la key encriptada de telnyx_config y la desencripta", async () => {
    mockTelnyxConfigRow({ api_key_encrypted: "iv:cipher:tag" })
    const { loadTelnyxApiKey } = await import("./api")
    await expect(loadTelnyxApiKey("acct-1")).resolves.toBe("decrypted-key")
  })

  it("lanza TelnyxApiError cuando no hay config", async () => {
    mockTelnyxConfigRow(null)
    const { loadTelnyxApiKey } = await import("./api")
    // resetModules() crea una nueva copia de la clase; validamos por nombre.
    await expect(loadTelnyxApiKey("acct-x")).rejects.toMatchObject({
      name: "TelnyxApiError",
    })
  })
})