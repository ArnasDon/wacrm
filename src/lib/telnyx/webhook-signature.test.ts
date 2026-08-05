import { describe, expect, it, vi, afterEach } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

// El helper lee TELNYX_WEBHOOK_PUBLIC_KEY al cargar el módulo, así que
// generamos una pareja Ed25519 real y la inyectamos antes del import.
function makeKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { spki, privateKey };
}

function load(publicKeyB64: string | undefined) {
  if (publicKeyB64 === undefined) delete process.env.TELNYX_WEBHOOK_PUBLIC_KEY;
  else process.env.TELNYX_WEBHOOK_PUBLIC_KEY = publicKeyB64;
  vi.resetModules();
  return import("./webhook-signature");
}

const { spki, privateKey } = makeKeys();

afterEach(() => {
  vi.resetModules();
});

describe("verifyTelnyxWebhook (Ed25519)", () => {
  it("acepta una firma válida sobre `${timestamp}|${body}`", async () => {
    const ts = String(Date.now());
    const body = JSON.stringify({ data: { event_type: "call.hangup" } });
    const sig = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64");

    const { verifyTelnyxWebhook } = await load(spki);
    expect(verifyTelnyxWebhook(ts, sig, body).ok).toBe(true);
  });

  it("rechaza un body manipulado", async () => {
    const ts = String(Date.now());
    const sig = sign(null, Buffer.from(`${ts}|original`), privateKey).toString("base64");
    const { verifyTelnyxWebhook } = await load(spki);
    expect(verifyTelnyxWebhook(ts, sig, "tampered").ok).toBe(false);
  });

  it("rechaza un timestamp viejo (replay)", async () => {
    const ts = String(Date.now() - 600_000); // > 5 min
    const body = "x";
    const sig = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64");
    const { verifyTelnyxWebhook } = await load(spki);
    expect(verifyTelnyxWebhook(ts, sig, body).ok).toBe(false);
  });

  it("falla cerrado cuando falta la clave pública", async () => {
    const ts = String(Date.now());
    const body = "x";
    const sig = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64");
    const { verifyTelnyxWebhook } = await load(undefined);
    expect(verifyTelnyxWebhook(ts, sig, body)).toMatchObject({ ok: false });
  });

  it("falla si faltan headers de firma", async () => {
    const { verifyTelnyxWebhook } = await load(spki);
    expect(verifyTelnyxWebhook(null, null, "x")).toMatchObject({ ok: false });
  });
});