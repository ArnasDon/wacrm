import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

const CONFIG_ROW = {
  resend_api_key_encrypted: "iv:x:t",
  from_email: "Mi Pyme <hola@midominio.com>",
  reply_to: null,
}
const INPUT = { to: "cliente@correo.com", subject: "Hola", html: "<p>hi</p>" }

function mockAdminClient(data: unknown = CONFIG_ROW) {
  return {
    supabaseAdmin: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data, error: null }),
          }),
        }),
      }),
    }),
  }
}

describe("sendEmail", () => {
  beforeEach(() => {
    vi.doMock("@/lib/telnyx/admin-client", () => mockAdminClient())
    vi.doMock("@/lib/whatsapp/encryption", () => ({
      decrypt: (s: string) => (s === "iv:x:t" ? "resend-key" : "?"),
    }))
    vi.resetModules()
  })
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it("carga config, desencripta la key y envía vía Resend", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null })
    vi.doMock("resend", () => ({ Resend: class { emails = { send } } }))
    vi.resetModules()

    const { sendEmail } = await import("./send")
    await expect(sendEmail("acct-1", INPUT)).resolves.toEqual({ id: "email-1" })

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Mi Pyme <hola@midominio.com>",
        to: ["cliente@correo.com"],
        subject: "Hola",
        html: "<p>hi</p>",
      }),
    )
  })

  it("lanza EmailError cuando Resend devuelve un error", async () => {
    vi.doMock("resend", () => ({
      Resend: class {
        emails = {
          send: vi.fn().mockResolvedValue({ data: null, error: new Error("rate limited") }),
        }
      },
    }))
    vi.resetModules()

    const { sendEmail } = await import("./send")
    await expect(sendEmail("acct-1", INPUT)).rejects.toMatchObject({
      name: "EmailError",
    })
  })

  it("lanza EmailError cuando no hay config del account", async () => {
    vi.doMock("@/lib/telnyx/admin-client", () => mockAdminClient(null))
    vi.doMock("resend", () => ({ Resend: class {} }))
    vi.resetModules()

    const { sendEmail } = await import("./send")
    await expect(sendEmail("acct-x", INPUT)).rejects.toMatchObject({
      name: "EmailError",
    })
  })
})