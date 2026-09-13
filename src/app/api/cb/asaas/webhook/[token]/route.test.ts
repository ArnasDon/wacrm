import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dubleDoSupabase, type EstadoDoDuble } from "@/lib/asaas/duble.test-helper";
import { __resetRateLimitForTests } from "@/lib/rate-limit";
import { encrypt } from "@/lib/whatsapp/encryption";

// A rota pública do webhook do Asaas (997), exercitada com o dublê do
// Supabase: a ORDEM das respostas (404 → 401 → 200), a reentrega, o balde
// POR CONTA depois da autenticação, e a "prova de vida" que só cura os
// estados certos. Sem isto a ordem só existia num curl do preview.

const estado: EstadoDoDuble = { tabelas: {}, escritas: [] };
const processados: unknown[] = [];

vi.mock("@/lib/automations/admin-client", () => ({ supabaseAdmin: () => dubleDoSupabase(estado) }));
vi.mock("@/lib/asaas/webhook-asaas", () => ({ processarEvento: async (...args: unknown[]) => { processados.push(args); return "aplicada"; } }));
vi.mock("next/server", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => Promise<void>) => void fn() };
});

const { POST } = await import("./route");

const CONTA = "conta-1";
const TOKEN = "tok_0123456789abcdefghijklmnopqrs";
const AUTH = "auth_0123456789abcdefghijklmnopqrstuvwxyz0123456789";

function pedido(corpo: unknown, cabecalhos: Record<string, string> = {}): Request {
  return new Request(`https://crm.exemplo.com/api/cb/asaas/webhook/${TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
}
const chamar = (corpo: unknown, cabecalhos?: Record<string, string>, token = TOKEN) => POST(pedido(corpo, cabecalhos), { params: Promise.resolve({ token }) });
const entrega = (id = "evt_1&1") => ({ id, event: "PAYMENT_RECEIVED", dateCreated: "2026-09-13 13:30:00", payment: { id: "pay_1", customer: "cus_1", status: "RECEIVED" } });

beforeEach(() => {
  __resetRateLimitForTests();
  processados.length = 0;
  estado.tabelas = {
    cb_asaas_config: [{ account_id: CONTA, webhook_token: TOKEN, webhook_auth_token: encrypt(AUTH), webhook_state: "ativo", last_event_at: null }],
    cb_asaas_eventos: [],
  };
  estado.escritas = [];
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/cb/asaas/webhook/[token]", () => {
  it("URL malformada e token desconhecido são 404; sem o cabeçalho (ou errado) é 401 — e nada é gravado", async () => {
    expect((await chamar(entrega(), {}, "curto")).status).toBe(404);
    expect((await chamar(entrega(), {}, "tok_desconhecido_00000000000000")).status).toBe(404);
    expect((await chamar(entrega())).status).toBe(401);
    expect((await chamar(entrega(), { "asaas-access-token": "errado" })).status).toBe(401);
    expect(estado.tabelas.cb_asaas_eventos).toEqual([]);
    expect(processados).toEqual([]);
  });

  it("entrega válida: 200, o evento gravado com o dateCreated CRU, a prova de vida e o processamento em after()", async () => {
    const res = await chamar(entrega(), { "asaas-access-token": AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(estado.tabelas.cb_asaas_eventos).toHaveLength(1);
    expect(estado.tabelas.cb_asaas_eventos[0]).toMatchObject({ account_id: CONTA, asaas_event_id: "evt_1&1", evento: "PAYMENT_RECEIVED", asaas_payment_id: "pay_1", evento_criado_em: "2026-09-13 13:30:00" });
    expect(estado.tabelas.cb_asaas_config[0].last_event_at).toBeTruthy();
    expect(processados).toHaveLength(1);
  });

  it("a reentrega do MESMO id responde duplicado e não processa de novo", async () => {
    await chamar(entrega(), { "asaas-access-token": AUTH });
    const res = await chamar(entrega(), { "asaas-access-token": AUTH });
    expect(await res.json()).toEqual({ ok: true, duplicado: true });
    expect(estado.tabelas.cb_asaas_eventos).toHaveLength(1);
    expect(processados).toHaveLength(1);
  });

  it("corpo sem id/event é 200 ignorado; corpo que não é JSON também", async () => {
    expect(await (await chamar({ foo: 1 }, { "asaas-access-token": AUTH })).json()).toEqual({ ok: true, ignorado: true });
    expect(await (await chamar("lixo", { "asaas-access-token": AUTH })).json()).toEqual({ ok: true, ignorado: true });
    expect(estado.tabelas.cb_asaas_eventos).toEqual([]);
  });

  it("a prova de vida cura `interrompido`/`penalizado`, mas NÃO `desligado`/`erro`/nulo (retentativa antiga depois do DELETE)", async () => {
    for (const [antes, depois] of [["interrompido", "ativo"], ["penalizado", "ativo"], ["desligado", "desligado"], ["erro", "erro"], [null, null]] as const) {
      estado.tabelas.cb_asaas_config[0].webhook_state = antes;
      estado.tabelas.cb_asaas_config[0].last_event_at = null;
      await chamar(entrega(`evt_${String(antes)}`), { "asaas-access-token": AUTH });
      expect(estado.tabelas.cb_asaas_config[0].webhook_state).toBe(depois);
    }
  });

  it("o balde POR CONTA só conta entregas AUTENTICADAS — antes da autenticação só o balde por IP; estourado, responde 200 adiado sem gravar", async () => {
    const rl = await import("@/lib/rate-limit");
    const espiao = vi.spyOn(rl, "checkRateLimit");
    for (let i = 0; i < 5; i++) await chamar(entrega(`evt_x${i}`), { "asaas-access-token": "errado" });
    expect(espiao.mock.calls.every(([chave]) => String(chave).startsWith("asaas:webhook:ip:"))).toBe(true);
    espiao.mockClear();
    espiao.mockImplementation((chave, opcoes) =>
      String(chave) === `asaas:webhook:${CONTA}` ? { success: false, remaining: 0, reset: Date.now() + 1000, limit: 600 } : { success: true, remaining: 1, reset: Date.now() + 1000, limit: opcoes.limit },
    );
    const res = await chamar(entrega("evt_adiado"), { "asaas-access-token": AUTH });
    expect(await res.json()).toEqual({ ok: true, adiado: true });
    expect(espiao.mock.calls.map(([c]) => String(c))).toEqual([expect.stringMatching(/^asaas:webhook:ip:/), `asaas:webhook:${CONTA}`]);
    expect(estado.tabelas.cb_asaas_eventos).toEqual([]);
  });

  it("o balde por IP estourado responde 200 adiado ANTES do banco — o atacante com a URL não força leitura nem decifragem", async () => {
    const rl = await import("@/lib/rate-limit");
    const espiao = vi.spyOn(rl, "checkRateLimit").mockReturnValue({ success: false, remaining: 0, reset: Date.now() + 1000, limit: 1200 });
    const res = await chamar(entrega("evt_ip"), { "asaas-access-token": AUTH, "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
    expect(await res.json()).toEqual({ ok: true, adiado: true });
    expect(espiao.mock.calls.map(([c]) => String(c))).toEqual(["asaas:webhook:ip:203.0.113.9"]);
    expect(estado.tabelas.cb_asaas_eventos).toEqual([]);
  });
});
