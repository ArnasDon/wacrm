import { describe, expect, it } from "vitest";

import { dividaDoContato, dividasPorContato, idsInadimplentes, lerRespostaDoContato, lerRespostaDoResumo, separarParcelas, type RespostaDoResumo } from "./aviso-na-conversa";
import type { ParcelaDoEspelho } from "./inadimplencia";

const AGORA = new Date("2026-09-12T15:00:00Z");
const LISTADAS_EM = "2026-09-12T14:50:00Z";

function parcela(patch: Partial<ParcelaDoEspelho> & { id: string }): ParcelaDoEspelho {
  return {
    asaas_payment_id: `pay_${patch.id}`,
    asaas_customer_id: "cus_1",
    status: "OVERDUE",
    deleted: false,
    valor: 100,
    juros_e_multa: null,
    vencimento: "2026-09-01",
    vencimento_original: null,
    vista_vencida_em: null,
    pago_em: null,
    forma: null,
    pode_pagar_apos_vencimento: null,
    dias_ate_cancelar_registro: null,
    descricao: null,
    parcelamento_id: null,
    parcela_numero: null,
    parcela_total: null,
    link_fatura: null,
    link_boleto: null,
    visto_em: LISTADAS_EM,
    ...patch,
  };
}

/** A forma que a rota devolve (JSON cru), com os campos mínimos. */
function corpo(contatos: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown {
  return { conectado: true, leituraFresca: true, atualizadoEm: LISTADAS_EM, contatos, ...extra };
}

describe("lerRespostaDoResumo — parse defensivo", () => {
  it("corpo estranho vira null (não sei), nunca um resumo vazio", () => {
    expect(lerRespostaDoResumo(null)).toBeNull();
    expect(lerRespostaDoResumo("x")).toBeNull();
    expect(lerRespostaDoResumo({})).toBeNull();
    expect(lerRespostaDoResumo({ conectado: "sim", leituraFresca: true })).toBeNull();
    expect(lerRespostaDoResumo({ error: "db_error" })).toBeNull();
  });

  it("lê as parcelas campo a campo e descarta as malformadas", () => {
    const lido = lerRespostaDoResumo(
      corpo({
        "ct-1": [parcela({ id: "a" }), { id: "sem-valor", asaas_payment_id: "p", asaas_customer_id: "c", status: "OVERDUE", vencimento: "2026-09-01", visto_em: LISTADAS_EM }],
        "ct-2": [{ nada: true }],
        "ct-3": "lixo",
      }),
    );
    expect(lido).not.toBeNull();
    expect(Object.keys(lido!.contatos)).toEqual(["ct-1"]);
    expect(lido!.contatos["ct-1"]).toHaveLength(1);
    expect(lido!.atualizadoEm).toBe(LISTADAS_EM);
  });

  it("desconectado é uma resposta válida, com contatos vazios", () => {
    expect(lerRespostaDoResumo({ conectado: false, leituraFresca: false, atualizadoEm: null, contatos: {} })).toEqual({ conectado: false, leituraFresca: false, atualizadoEm: null, contatos: {} });
  });
});

describe("dividasPorContato / dividaDoContato", () => {
  const resumo = lerRespostaDoResumo(
    corpo({
      "ct-deve": [parcela({ id: "a", vencimento: "2026-08-20", valor: 200 }), parcela({ id: "b", vencimento: "2026-09-05", valor: 100, juros_e_multa: 8 })],
      // devida que NÃO voltou na última listagem: em conferência, sem dívida afirmada
      "ct-conferencia": [parcela({ id: "c", visto_em: "2026-09-11T10:00:00Z" })],
    }),
  ) as RespostaDoResumo;

  it("só quem tem vencida VISTA na última listagem entra no mapa", () => {
    const mapa = dividasPorContato(resumo, AGORA);
    expect([...mapa.keys()]).toEqual(["ct-deve"]);
    const d = mapa.get("ct-deve")!;
    expect(d.vencidas.map((p) => p.id)).toEqual(["a", "b"]);
    expect(d.total).toBe(300);
    expect(d.totalAtualizado).toBe(308);
    expect(d.desde).toBe("2026-08-20");
    expect(d.dias).toBe(23);
  });

  it("dividaDoContato: a dívida de UM contato, ou null (em dia, em conferência, grupo sem contato, resumo nulo)", () => {
    expect(dividaDoContato(resumo, "ct-deve", AGORA)?.total).toBe(300);
    expect(dividaDoContato(resumo, "ct-conferencia", AGORA)).toBeNull();
    expect(dividaDoContato(resumo, "ct-outro", AGORA)).toBeNull();
    expect(dividaDoContato(resumo, null, AGORA)).toBeNull();
    expect(dividaDoContato(null, "ct-deve", AGORA)).toBeNull();
  });
});

describe("idsInadimplentes — o conjunto do filtro", () => {
  const contatos = { "ct-deve": [parcela({ id: "a" })] };

  it("com leitura fresca e conectado, o conjunto de quem deve", () => {
    expect(idsInadimplentes(lerRespostaDoResumo(corpo(contatos)), AGORA)).toEqual(new Set(["ct-deve"]));
  });

  it("⚠️ null (neutraliza) sem resumo ou desconectado — nunca um conjunto vazio com cara de 'ninguém deve'", () => {
    expect(idsInadimplentes(null, AGORA)).toBeNull();
    expect(idsInadimplentes(lerRespostaDoResumo(corpo(contatos, { conectado: false })), AGORA)).toBeNull();
  });

  it("leitura ANTIGA não neutraliza: é a mesma régua do ícone da linha, e a tela diz de quando é o dado", () => {
    expect(idsInadimplentes(lerRespostaDoResumo(corpo(contatos, { leituraFresca: false })), AGORA)).toEqual(new Set(["ct-deve"]));
  });
});

describe("lerRespostaDoContato", () => {
  it("corpo estranho vira null; clientes malformados são descartados", () => {
    expect(lerRespostaDoContato(null)).toBeNull();
    expect(lerRespostaDoContato({ conectado: true })).toBeNull();
    const lido = lerRespostaDoContato({
      conectado: true,
      leituraFresca: true,
      atualizadoEm: LISTADAS_EM,
      clientes: [{ id: "row-1", asaasId: "cus_1", nome: "Ana", origem: "telefone", notificacoesDesligadas: true }, { id: 3 }],
      parcelas: [parcela({ id: "a" }), "lixo"],
    });
    expect(lido?.clientes).toEqual([{ id: "row-1", asaasId: "cus_1", nome: "Ana", origem: "telefone", notificacoesDesligadas: true }]);
    expect(lido?.parcelas.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("separarParcelas — a aba Cobranças", () => {
  it("reparte em vencidas, em conferência, a vencer (hoje ou depois), regularizadas (30 dias) e estornadas", () => {
    const parcelas = [
      parcela({ id: "vencida", vencimento: "2026-09-01" }),
      parcela({ id: "conferencia", visto_em: "2026-09-11T10:00:00Z" }),
      parcela({ id: "hoje", status: "PENDING", vencimento: "2026-09-12" }),
      parcela({ id: "futura", status: "PENDING", vencimento: "2026-10-12" }),
      // a vencer com vencimento no passado: o Asaas ainda não a virou OVERDUE — nem dívida, nem "a vencer"
      parcela({ id: "pendente-atrasada", status: "PENDING", vencimento: "2026-09-10" }),
      parcela({ id: "paga-recente", status: "RECEIVED", pago_em: "2026-09-01" }),
      parcela({ id: "paga-antiga", status: "RECEIVED", pago_em: "2026-07-01" }),
      parcela({ id: "estornada", status: "REFUNDED" }),
      parcela({ id: "contestada", status: "CHARGEBACK_REQUESTED" }),
    ];
    const r = separarParcelas(parcelas, AGORA, LISTADAS_EM);
    expect(r.divida.vencidas.map((p) => p.id)).toEqual(["vencida"]);
    expect(r.divida.emConferencia.map((p) => p.id)).toEqual(["conferencia"]);
    expect(r.aVencer.map((p) => p.id)).toEqual(["hoje", "futura"]);
    expect(r.regularizadas.map((p) => p.id)).toEqual(["paga-recente"]);
    expect(r.estornadas.map((p) => p.id)).toEqual(["estornada", "contestada"]);
  });

  it("regularizadas saem da mais recente para a mais antiga", () => {
    const r = separarParcelas([parcela({ id: "p1", status: "RECEIVED", pago_em: "2026-08-20" }), parcela({ id: "p2", status: "RECEIVED", pago_em: "2026-09-10" })], AGORA, LISTADAS_EM);
    expect(r.regularizadas.map((p) => p.id)).toEqual(["p2", "p1"]);
  });
});
