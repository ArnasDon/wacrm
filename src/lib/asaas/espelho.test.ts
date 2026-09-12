import { describe, expect, it } from "vitest";

import { dubleDoSupabase, type EstadoDoDuble } from "./duble.test-helper";
import { LEITURA_FRESCA_MS, leituraFresca, lerEspelho, lerParcela } from "./espelho";

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
