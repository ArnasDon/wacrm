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
  // El mock de admin-client se registra DENTRO de cada test, no aquí.
  //
  // Estaba en el beforeEach con la fila poblada, y el tercer test volvía a
  // registrarlo con `null` para probar el caso "sin config". Registrar dos
  // veces la misma ruta y confiar en que gana la segunda hacía el test
  // intermitente: cuando ganaba la del beforeEach, sendEmail sí encontraba
  // config, llegaba hasta Resend —simulado ahí como `class {}`, sin
  // `emails`— y reventaba con un TypeError en vez del EmailError esperado.
  // Fallaba una de cada seis pasadas del suite completo y nunca en
  // solitario, que es el perfil clásico de dependencia del orden.
  beforeEach(() => {
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
    vi.doMock("@/lib/telnyx/admin-client", () => mockAdminClient())
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
    vi.doMock("@/lib/telnyx/admin-client", () => mockAdminClient())
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
    // Sin config no se debe llegar a Resend. Si se llega, que lo diga con
    // esas palabras en vez de con un TypeError sobre `undefined.send`.
    vi.doMock("resend", () => ({
      Resend: class {
        emails = {
          send: () => {
            throw new Error("sendEmail llegó a Resend sin config del account")
          },
        }
      },
    }))
    vi.resetModules()

    const { sendEmail } = await import("./send")
    await expect(sendEmail("acct-x", INPUT)).rejects.toMatchObject({
      name: "EmailError",
    })
  })
})