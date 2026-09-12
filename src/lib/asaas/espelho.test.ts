import { describe, expect, it } from "vitest";

import { LEITURA_FRESCA_MS, leituraFresca, lerParcela } from "./espelho";

describe("leituraFresca", () => {
  const agora = new Date("2026-09-12T15:00:00Z");
  const base = { status: "conectado", last_sync_at: null, last_sync_attempt_at: null, vencidas_listadas_em: "2026-09-12T14:50:00Z", last_full_sync_at: null, last_error: null };

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
