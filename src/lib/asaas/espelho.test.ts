import { describe, expect, it } from "vitest";

import { dubleDoSupabase, type EstadoDoDuble } from "./duble.test-helper";
import { LEITURA_FRESCA_MS, leituraFresca, lerCobrancasDosClientes, lerEspelho, lerParcela } from "./espelho";

describe("leituraFresca", () => {
  const agora = new Date("2026-09-12T15:00:00Z");
  const base = { status: "conectado", last_sync_at: null, last_sync_attempt_at: null, vencidas_listadas_em: "2026-09-12T14:50:00Z", last_full_sync_at: null, sincronizando_desde: null, last_error: null };

  it("fresca só conectado, sem erro, e com a última listagem completa dentro de duas voltas do laço lento", () => {
    expect(leituraFresca(base, agora)).toBe(true);
    expect(leituraFresca({ ...base, status: "erro" }, agora)).toBe(false);
    expect(leituraFresca({ ...base, vencidas_listadas_em: null }, agora)).toBe(false);
    expect(leituraFresca({ ...base, vencidas_listadas_em: new Date(agora.getTime() - LEITURA_FRESCA_MS - 1).toISOString() }, agora)).toBe(false);
    expect(leituraFresca(null, agora)).toBe(false);
  });
});

describe("lerParcela", () => {
  it("lê os numéricos que o PostgREST devolve como texto", () => {
    const p = lerParcela({ id: "x", asaas_payment_id: "pay", asaas_customer_id: "cus", status: "OVERDUE", deleted: false, valor: "620.00", juros_e_multa: "28.20", vencimento: "2026-09-01", visto_em: "2026-09-12T10:00:00Z", parcela_numero: 3 });
    expect(p.valor).toBe(620);
    expect(p.juros_e_multa).toBe(28.2);
    expect(p.parcela_numero).toBe(3);
    expect(p.parcela_total).toBeNull();
  });
});

describe("lerEspelho", () => {
  const CONTA = "conta-1";
  function estado(): EstadoDoDuble {
    return {
      tabelas: {
        cb_asaas_config: [{ account_id: CONTA, status: "conectado", last_sync_at: null, last_sync_attempt_at: null, vencidas_listadas_em: "2026-09-12T14:50:00Z", last_full_sync_at: null, sincronizando_desde: null, last_error: null }],
        cb_asaas_clientes: [],
        cb_asaas_cobrancas: [{ id: "p", account_id: CONTA, asaas_payment_id: "pay", asaas_customer_id: "cus", status: "NOVO_STATUS", deleted: false, valor: 1, vencimento: "2026-09-01", visto_em: "2026-09-12T14:50:00Z" }],
        contacts: [],
      },
      escritas: [],
    };
  }

  it("a contagem de status desconhecidos vem do banco, não das devidas já filtradas", async () => {
    const admin = dubleDoSupabase(estado());
    const e = await lerEspelho(admin, CONTA, new Date("2026-09-12T15:00:00Z"));
    expect(e.conectado).toBe(true);
    expect(e.leituraFresca).toBe(true);
    // a devida não aparece (o status não é vencida), mas o desconhecido é contado
    expect(e.listas.resumo.inadimplentes).toBe(0);
    expect(e.listas.resumo.statusDesconhecidos).toBe(1);
  });

  it("a contagem que falha DERRUBA a leitura — nunca um zero falso", async () => {
    const admin = dubleDoSupabase(estado());
    const original = admin.from.bind(admin);
    (admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = original(t) as unknown as Record<string, unknown> & { select: (...a: unknown[]) => unknown };
      if (t === "cb_asaas_cobrancas") {
        const select = q.select;
        q.select = (...a: unknown[]) => {
          const opts = a[1] as { head?: boolean } | undefined;
          if (opts?.head) return { eq: () => ({ eq: () => ({ not: () => Promise.resolve({ count: null, error: { message: "boom" } }) }) }) };
          return select.apply(q, a);
        };
      }
      return q;
    };
    await expect(lerEspelho(admin, CONTA, new Date("2026-09-12T15:00:00Z"))).rejects.toThrow(/contagem falhou/);
  });
});

describe("lerCobrancasDosClientes — a aba Cobranças", () => {
  const CONTA = "conta-1";

  it("⚠️ PAGINA: mais de 1.000 cobranças do mesmo cliente voltam inteiras, na ordem do vencimento (um `.limit(1000)` calava sobre as mais novas)", async () => {
    const cobrancas = Array.from({ length: 1203 }, (_, i) => ({
      id: `p${String(i).padStart(4, "0")}`,
      account_id: CONTA,
      asaas_payment_id: `pay_${i}`,
      asaas_customer_id: i % 2 === 0 ? "cus_a" : "cus_b",
      status: i === 1202 ? "OVERDUE" : "RECEIVED",
      deleted: false,
      valor: 1,
      vencimento: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      visto_em: "2026-09-12T14:50:00Z",
    }));
    const admin = dubleDoSupabase({ tabelas: { cb_asaas_cobrancas: cobrancas, cb_asaas_clientes: [], contacts: [], cb_asaas_config: [] }, escritas: [] });
    const lidas = await lerCobrancasDosClientes(admin, CONTA, ["cus_a", "cus_b"]);
    expect(lidas).toHaveLength(1203);
    // a mais NOVA (a vencida) está lá — é a que o teto de 1.000 escondia
    expect(lidas.at(-1)?.id).toBe("p1202");
    expect(lidas.at(-1)?.status).toBe("OVERDUE");
    // e só os clientes pedidos
    expect(await lerCobrancasDosClientes(admin, CONTA, ["cus_a"])).toHaveLength(602);
    expect(await lerCobrancasDosClientes(admin, CONTA, [])).toEqual([]);
  });
});
