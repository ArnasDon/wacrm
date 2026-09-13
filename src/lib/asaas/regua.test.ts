import { describe, expect, it } from "vitest";

import { dinheiro, type ParcelaDoEspelho } from "./inadimplencia";
import {
  agruparLembretes,
  agruparPorCliente,
  aindaPagavel,
  dentroDoIntervalo,
  diaAlvoDoMarco,
  diasDoLembrete,
  diaUtilAnterior,
  ehDiaUtil,
  ehGatilhoDaRegua,
  entrouNaRegua,
  horaDeEnvioValida,
  janelaAberta,
  lerAutomacaoDaRegua,
  linhaDaParcela,
  montarVariaveis,
  proximoDiaUtil,
  RESULTADOS_DA_TRAVA,
  resultadoDoLog,
  somarDias,
  textoDoVencimento,
  type AutomacaoDaRegua,
  type ContextoDaRegua,
} from "./regua";

const FUSO = "America/Sao_Paulo";

function parcela(extra: Partial<ParcelaDoEspelho> = {}): ParcelaDoEspelho {
  return {
    id: "c-1",
    asaas_payment_id: "pay_1",
    asaas_customer_id: "cus_1",
    status: "OVERDUE",
    deleted: false,
    valor: 620,
    juros_e_multa: null,
    vencimento: "2026-09-10",
    vencimento_original: null,
    vista_vencida_em: "2026-09-11T03:10:00Z",
    pago_em: null,
    forma: "BOLETO",
    pode_pagar_apos_vencimento: true,
    dias_ate_cancelar_registro: null,
    descricao: null,
    parcelamento_id: "inst_1",
    parcela_numero: 3,
    parcela_total: 12,
    link_fatura: "https://www.asaas.com/i/abc",
    link_boleto: null,
    visto_em: "2026-09-14T12:00:00Z",
    ...extra,
  };
}

const ATIVADA = "2026-09-01T12:00:00Z";
const ctx = (hoje: string, extra: Partial<ContextoDaRegua> = {}): ContextoDaRegua => ({ hoje, reguaAtivadaEm: ATIVADA, somenteDiasUteis: true, fuso: FUSO, ...extra });
const cobranca = (marco: number, extra: Partial<AutomacaoDaRegua> = {}): AutomacaoDaRegua => ({ id: `a-${marco}`, nome: `Cobrança · ${marco} dias`, tipo: "atraso", marco, horaEnvio: "09:00", somenteDiasUteis: true, ...extra });
const lembrete = (extra: Partial<AutomacaoDaRegua> = {}): AutomacaoDaRegua => ({ id: "a-0", nome: "Lembrete", tipo: "vence_hoje", marco: 0, horaEnvio: "08:00", somenteDiasUteis: true, ...extra });
/** 2026-09-14 é segunda-feira. `h` em São Paulo (UTC-3). */
const em = (dia: string, h: string) => new Date(`${dia}T${h}:00-03:00`);

describe("dias: aritmética de texto, dia útil, feriado fixo", () => {
  it("soma dias sem passar por meia-noite UTC; sábado e domingo não são úteis; 07/09 é feriado", () => {
    expect(somarDias("2026-09-30", 1)).toBe("2026-10-01");
    expect(somarDias("2026-09-01", -1)).toBe("2026-08-31");
    expect(ehDiaUtil("2026-09-12")).toBe(false); // sábado
    expect(ehDiaUtil("2026-09-13")).toBe(false); // domingo
    expect(ehDiaUtil("2026-09-14")).toBe(true); // segunda
    expect(ehDiaUtil("2026-09-07")).toBe(false); // Independência
    expect(proximoDiaUtil("2026-09-12")).toBe("2026-09-14");
    expect(proximoDiaUtil("2026-09-14")).toBe("2026-09-14");
    expect(diaUtilAnterior("2026-09-14")).toBe("2026-09-11");
    expect(diaUtilAnterior("2026-09-08")).toBe("2026-09-04"); // pula o feriado e o fim de semana
  });

  it("a hora de envio aceita 08:00–17:00", () => {
    expect(horaDeEnvioValida("09:00")).toBe(true);
    expect(horaDeEnvioValida("17:00")).toBe(true);
    expect(horaDeEnvioValida("07:59")).toBe(false);
    expect(horaDeEnvioValida("18:00")).toBe(false);
    expect(horaDeEnvioValida("9h")).toBe(false);
    expect(horaDeEnvioValida(null)).toBe(false);
  });
});

describe("entrouNaRegua (D13) — só o que foi visto vencido DEPOIS de ligar", () => {
  it("vista antes da ativação fica de fora para sempre; vista depois entra", () => {
    expect(entrouNaRegua({ vista_vencida_em: "2026-08-30T00:00:00Z" }, ATIVADA)).toBe(false);
    expect(entrouNaRegua({ vista_vencida_em: "2026-09-11T03:10:00Z" }, ATIVADA)).toBe(true);
    expect(entrouNaRegua({ vista_vencida_em: null }, ATIVADA)).toBe(false);
    expect(entrouNaRegua({ vista_vencida_em: "2026-09-11T03:10:00Z" }, null)).toBe(false);
  });
});

describe("diaAlvoDoMarco", () => {
  it("vencimento + marco; fim de semana empurra para a segunda", () => {
    // venceu quinta 10/09; marco 1 = sexta 11/09
    expect(diaAlvoDoMarco(parcela(), 1, ctx("2026-09-11"))).toBe("2026-09-11");
    // venceu sexta 11/09; marco 1 = sábado → segunda 14/09
    expect(diaAlvoDoMarco(parcela({ vencimento: "2026-09-11", vista_vencida_em: "2026-09-12T03:00:00Z" }), 1, ctx("2026-09-14"))).toBe("2026-09-14");
    expect(diaAlvoDoMarco(parcela({ vencimento: "2026-09-11", vista_vencida_em: "2026-09-12T03:00:00Z" }), 1, ctx("2026-09-14", { somenteDiasUteis: false }))).toBe("2026-09-12");
  });

  it("o espelho viu vencida DEPOIS do marco (C7, sincronização parada): o dia da vista, até 3 dias; passado disso o marco é perdido", () => {
    // venceu 10/09, marco 1 = 11/09, mas só vista em 13/09 03:00Z = 13/09 00:00 local → alvo 13/09 (domingo) → 14/09 útil
    expect(diaAlvoDoMarco(parcela({ vista_vencida_em: "2026-09-13T03:00:00Z" }), 1, ctx("2026-09-14"))).toBe("2026-09-14");
    // vista em 20/09: mais de 3 dias depois dos marcos de 1 (11/09) e de 5 (15/09) → os dois perdidos; o de 30 (10/10, sábado → 12/10 feriado → 13/10) cobre
    expect(diaAlvoDoMarco(parcela({ vista_vencida_em: "2026-09-20T12:00:00Z" }), 1, ctx("2026-09-21"))).toBeNull();
    expect(diaAlvoDoMarco(parcela({ vista_vencida_em: "2026-09-20T12:00:00Z" }), 5, ctx("2026-09-21"))).toBeNull();
    expect(diaAlvoDoMarco(parcela({ vista_vencida_em: "2026-09-20T12:00:00Z" }), 30, ctx("2026-09-21"))).toBe("2026-10-13");
  });

  it("a vista é lida no FUSO: 23h em São Paulo ainda é o mesmo dia", () => {
    // 2026-09-12T02:30Z = 11/09 23:30 em São Paulo → vista = 11/09 = o próprio marco de 1 → alvo 11/09
    expect(diaAlvoDoMarco(parcela({ vista_vencida_em: "2026-09-12T02:30:00Z" }), 1, ctx("2026-09-11"))).toBe("2026-09-11");
  });

  it("marco inválido ou vencimento estranho → null", () => {
    expect(diaAlvoDoMarco(parcela(), 0, ctx("2026-09-11"))).toBeNull();
    expect(diaAlvoDoMarco(parcela({ vencimento: "10/09/2026" }), 1, ctx("2026-09-11"))).toBeNull();
  });
});

describe("janelaAberta — da hora de envio até as 18:00 no fuso", () => {
  it("antes da hora fecha; entre a hora e as 18h abre; às 18h fecha", () => {
    expect(janelaAberta(em("2026-09-14", "08:59"), "2026-09-14", "09:00", FUSO)).toBe(false);
    expect(janelaAberta(em("2026-09-14", "09:00"), "2026-09-14", "09:00", FUSO)).toBe(true);
    expect(janelaAberta(em("2026-09-14", "17:59"), "2026-09-14", "09:00", FUSO)).toBe(true);
    expect(janelaAberta(em("2026-09-14", "18:00"), "2026-09-14", "09:00", FUSO)).toBe(false);
  });
});

describe("diasDoLembrete (D17) — empurrar, nunca pular", () => {
  it("segunda cobre sábado, domingo e a própria segunda; sábado não cobre nada; sem 'só dia útil' cobre só hoje", () => {
    expect(diasDoLembrete("2026-09-14", true)).toEqual(["2026-09-12", "2026-09-13", "2026-09-14"]);
    expect(diasDoLembrete("2026-09-12", true)).toEqual([]);
    expect(diasDoLembrete("2026-09-15", true)).toEqual(["2026-09-15"]);
    expect(diasDoLembrete("2026-09-12", false)).toEqual(["2026-09-12"]);
    // terça 08/09: cobre o feriado (07/09) e o fim de semana antes dele
    expect(diasDoLembrete("2026-09-08", true)).toEqual(["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"]);
  });
});

describe("aindaPagavel e dentroDoIntervalo", () => {
  it("o que o Asaas diz que não pode mais ser pago fica fora; o registro cancelado N dias depois também", () => {
    expect(aindaPagavel(parcela(), "2026-09-14")).toBe(true);
    expect(aindaPagavel(parcela({ pode_pagar_apos_vencimento: false }), "2026-09-14")).toBe(false);
    expect(aindaPagavel(parcela({ dias_ate_cancelar_registro: 3 }), "2026-09-13")).toBe(true);
    expect(aindaPagavel(parcela({ dias_ate_cancelar_registro: 3 }), "2026-09-14")).toBe(false);
  });

  it("o intervalo de 3 dias conta em dias de calendário no fuso: enviada dia 10, livre a partir do 13", () => {
    const enviada = "2026-09-10T12:05:00-03:00";
    expect(dentroDoIntervalo(enviada, "2026-09-12", 3, FUSO)).toBe(true);
    expect(dentroDoIntervalo(enviada, "2026-09-13", 3, FUSO)).toBe(false);
    expect(dentroDoIntervalo(null, "2026-09-13", 3, FUSO)).toBe(false);
    expect(dentroDoIntervalo(enviada, "2026-09-11", 0, FUSO)).toBe(false);
    // enviada às 23h local do dia 10 (02h UTC do 11): ainda é dia 10
    expect(dentroDoIntervalo("2026-09-11T02:00:00Z", "2026-09-13", 3, FUSO)).toBe(false);
  });
});

describe("lerAutomacaoDaRegua e ehGatilhoDaRegua", () => {
  it("lê marco, hora e dias úteis; recusa marco fora de 1..365; padrões 09:00/08:00 e dias úteis", () => {
    expect(lerAutomacaoDaRegua({ id: "a", name: "x", trigger_type: "asaas_cobranca_vencida", trigger_config: { dias_de_atraso: 5, hora_envio: "10:30", somente_dias_uteis: false } })).toEqual({ id: "a", nome: "x", tipo: "atraso", marco: 5, horaEnvio: "10:30", somenteDiasUteis: false });
    expect(lerAutomacaoDaRegua({ id: "a", name: "x", trigger_type: "asaas_cobranca_vencida", trigger_config: { dias_de_atraso: 0 } })).toBeNull();
    expect(lerAutomacaoDaRegua({ id: "a", name: "x", trigger_type: "asaas_cobranca_vencida", trigger_config: { dias_de_atraso: "30" } })?.marco).toBe(30);
    expect(lerAutomacaoDaRegua({ id: "b", name: "y", trigger_type: "asaas_cobranca_vence_hoje", trigger_config: {} })).toEqual({ id: "b", nome: "y", tipo: "vence_hoje", marco: 0, horaEnvio: "08:00", somenteDiasUteis: true });
    expect(lerAutomacaoDaRegua({ id: "c", name: "z", trigger_type: "keyword_match", trigger_config: {} })).toBeNull();
    expect(ehGatilhoDaRegua("asaas_cobranca_vencida")).toBe(true);
    expect(ehGatilhoDaRegua("date_field_offset")).toBe(false);
  });
});

describe("agruparPorCliente (D11) — uma mensagem por cliente, através das automações", () => {
  const segunda = em("2026-09-14", "09:30");

  it("marco de 30 dias da parcela de agosto e de 1 dia da de setembro no mesmo dia: UM grupo, pela automação de maior marco, com as duas travas", () => {
    // setembro: venceu sex 11/09 (vista sáb 12/09) → marco 1 = sáb → seg 14/09
    // agosto: venceu sáb 15/08 (vista dom 16/08) → marco 30 = 14/09 (seg)
    const set = parcela({ id: "c-set", asaas_payment_id: "pay_set", vencimento: "2026-09-11", vista_vencida_em: "2026-09-12T03:00:00Z" });
    const ago = parcela({ id: "c-ago", asaas_payment_id: "pay_ago", vencimento: "2026-08-15", vista_vencida_em: "2026-09-02T03:00:00Z" });
    const grupos = agruparPorCliente([cobranca(1), cobranca(5), cobranca(30)], [set, ago], ctx("2026-09-14"), segunda);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].automacao.marco).toBe(30);
    // maior marco primeiro (a ordem determinística das automações)
    expect(grupos[0].cruzaram.map((c) => [c.parcela.asaas_payment_id, c.automacao.marco])).toEqual([
      ["pay_ago", 30],
      ["pay_set", 1],
    ]);
  });

  it("parcela vista ANTES da ativação (o atrasado antigo) não cruza marco nenhum; negativada cruza como vencida (D6 revista); paga não", () => {
    const antiga = parcela({ vencimento: "2026-09-11", vista_vencida_em: "2026-08-20T03:00:00Z" });
    expect(agruparPorCliente([cobranca(1)], [antiga], ctx("2026-09-14"), segunda)).toEqual([]);
    const negativada = parcela({ vencimento: "2026-09-11", vista_vencida_em: "2026-09-12T03:00:00Z", status: "DUNNING_REQUESTED" });
    expect(agruparPorCliente([cobranca(1)], [negativada], ctx("2026-09-14"), segunda)).toHaveLength(1);
    const paga = parcela({ vencimento: "2026-09-11", vista_vencida_em: "2026-09-12T03:00:00Z", status: "RECEIVED" });
    expect(agruparPorCliente([cobranca(1)], [paga], ctx("2026-09-14"), segunda)).toEqual([]);
  });

  it("duas automações LIGADAS com o MESMO marco: a parcela entra UMA vez no grupo, pela automação de menor id — sem isso o INSERT do grupo levava a chave duplicada, o 23505 era lido como 'outro processo pegou' e nenhuma enviava (Codex, PR #206)", () => {
    const set = parcela({ vencimento: "2026-09-11", vista_vencida_em: "2026-09-12T03:00:00Z" });
    const b = { ...cobranca(1), id: "b-1", nome: "Cobrança · 1 dia (cópia)" };
    const a = { ...cobranca(1), id: "a-1" };
    const grupos = agruparPorCliente([b, a], [set], ctx("2026-09-14"), segunda);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].cruzaram).toHaveLength(1);
    expect(grupos[0].automacao.id).toBe("a-1");
    // a ordem de entrada não muda a escolha
    expect(agruparPorCliente([a, b], [set], ctx("2026-09-14"), segunda)[0].automacao.id).toBe("a-1");
  });

  it("fora da janela da automação nada é candidato; cada automação tem a sua hora", () => {
    const set = parcela({ vencimento: "2026-09-11", vista_vencida_em: "2026-09-12T03:00:00Z" });
    expect(agruparPorCliente([cobranca(1, { horaEnvio: "10:00" })], [set], ctx("2026-09-14"), segunda)).toEqual([]);
    expect(agruparPorCliente([cobranca(1, { horaEnvio: "10:00" })], [set], ctx("2026-09-14"), em("2026-09-14", "10:00"))).toHaveLength(1);
  });

  it("clientes diferentes viram grupos diferentes", () => {
    const a = parcela({ vencimento: "2026-09-11", vista_vencida_em: "2026-09-12T03:00:00Z", asaas_customer_id: "cus_a" });
    const b = parcela({ id: "c-2", asaas_payment_id: "pay_2", vencimento: "2026-09-11", vista_vencida_em: "2026-09-12T03:00:00Z", asaas_customer_id: "cus_b" });
    expect(agruparPorCliente([cobranca(1)], [a, b], ctx("2026-09-14"), segunda).map((g) => g.asaasCustomerId).sort()).toEqual(["cus_a", "cus_b"]);
  });
});

describe("agruparLembretes (D17) — e a absorção pela cobrança do dia", () => {
  it("PENDING vencendo hoje entra; cliente com marco hoje é pulado (uma mensagem só); a vencida do sábado entra na segunda", () => {
    const hoje = parcela({ status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null, asaas_customer_id: "cus_a" });
    const comMarco = parcela({ id: "c-2", asaas_payment_id: "pay_2", status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null, asaas_customer_id: "cus_b" });
    const sabado = parcela({ id: "c-3", asaas_payment_id: "pay_3", status: "OVERDUE", vencimento: "2026-09-12", vista_vencida_em: "2026-09-13T03:00:00Z", asaas_customer_id: "cus_c" });
    const amanha = parcela({ id: "c-4", asaas_payment_id: "pay_4", status: "PENDING", vencimento: "2026-09-15", vista_vencida_em: null, asaas_customer_id: "cus_d" });
    const grupos = agruparLembretes([lembrete(), cobranca(1)], [hoje, comMarco, sabado, amanha], new Set(["cus_b"]), ctx("2026-09-14"), em("2026-09-14", "08:10"));
    expect(grupos.map((g) => g.asaasCustomerId).sort()).toEqual(["cus_a", "cus_c"]);
  });

  it("sem automação de lembrete, ou fora da janela, ou em fim de semana: nada", () => {
    const hoje = parcela({ status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null });
    expect(agruparLembretes([cobranca(1)], [hoje], new Set(), ctx("2026-09-14"), em("2026-09-14", "08:10"))).toEqual([]);
    expect(agruparLembretes([lembrete()], [hoje], new Set(), ctx("2026-09-14"), em("2026-09-14", "07:50"))).toEqual([]);
    const sab = parcela({ status: "PENDING", vencimento: "2026-09-12", vista_vencida_em: null });
    expect(agruparLembretes([lembrete()], [sab], new Set(), ctx("2026-09-12"), em("2026-09-12", "08:10"))).toEqual([]);
  });
});

describe("as variáveis da mensagem", () => {
  const agora = em("2026-09-14", "09:30");
  const p1 = parcela({ vencimento: "2026-08-23", parcela_numero: 3, juros_e_multa: 28.2 });
  const p2 = parcela({ id: "c-2", asaas_payment_id: "pay_2", vencimento: "2026-09-11", parcela_numero: 4, link_fatura: "https://www.asaas.com/i/def" });

  it("a cobrança lista TODAS as vencidas (D11), soma tudo, e os dias vêm da que cruzou e da mais antiga", () => {
    const v = montarVariaveis({ clienteNome: "andré da silva", escritorioNome: "CB Advogados", vencidas: [p1, p2], cruzaram: [p2], venceHoje: [], hoje: "2026-09-14", agora, fuso: FUSO });
    expect(v.cliente_primeiro_nome).toBe("André");
    expect(v.cobranca_detalhe).toBe(
      `• Parcela 3/12 — ${dinheiro(648.2)} (atualizado) — venceu em 23/08/2026 — https://www.asaas.com/i/abc\n• Parcela 4/12 — ${dinheiro(620)} (valor original) — venceu em 11/09/2026 — https://www.asaas.com/i/def`,
    );
    expect(v.cobranca_parcelas).toBe("3/12 e 4/12");
    expect(v.cobranca_valor).toBe(dinheiro(1268.2));
    expect(v.cobranca_vencimento).toBe("23/08/2026");
    expect(v.cobranca_quantidade).toBe("2");
    expect(v.dias_de_atraso).toBe("3");
    expect(v.dias_de_atraso_maior).toBe("22");
    expect(v.marco_detalhe).toContain("Parcela 4/12");
    expect(v.vence_hoje_detalhe).toBe("");
  });

  it("com parcela vencendo hoje junto (13/09: uma mensagem só), `vence_hoje_detalhe` traz a linha", () => {
    const hoje = parcela({ id: "c-3", asaas_payment_id: "pay_3", status: "PENDING", vencimento: "2026-09-14", vista_vencida_em: null, parcela_numero: 5 });
    const v = montarVariaveis({ clienteNome: "ANA", escritorioNome: "CB", vencidas: [p2], cruzaram: [p2], venceHoje: [hoje], hoje: "2026-09-14", agora, fuso: FUSO });
    expect(v.vence_hoje_detalhe).toBe(`• Parcela 5/12 — ${dinheiro(620)} (valor original) — vence hoje (14/09/2026) — https://www.asaas.com/i/abc`);
    expect(v.cliente_primeiro_nome).toBe("ANA");
    expect(v.vencimento_texto).toBe("vence hoje");
  });

  it("o lembrete fala só do que vence hoje; empurrado da sexta/sábado diz quando venceu e que pode pagar hoje", () => {
    const sab = parcela({ status: "OVERDUE", vencimento: "2026-09-12", vista_vencida_em: "2026-09-13T03:00:00Z", parcela_numero: 6, juros_e_multa: null });
    const v = montarVariaveis({ clienteNome: "Rubens", escritorioNome: "CB", vencidas: [], cruzaram: [], venceHoje: [sab], hoje: "2026-09-14", agora, fuso: FUSO });
    expect(v.cobranca_detalhe).toBe(`• Parcela 6/12 — ${dinheiro(620)} (valor original) — venceu em 12/09/2026 — https://www.asaas.com/i/abc`);
    expect(v.cobranca_quantidade).toBe("1");
    expect(v.cobranca_valor).toBe(dinheiro(620));
    expect(v.vencimento_texto).toBe("venceu no sábado, 12/09 — o boleto pode ser pago hoje sem juros");
    expect(textoDoVencimento([], "2026-09-14")).toBe("");
    // 07/09 (feriado) empurrado para 08/09
    expect(textoDoVencimento([parcela({ vencimento: "2026-09-07" })], "2026-09-08")).toBe("venceu no feriado, 07/09 — o boleto pode ser pago hoje sem juros");
  });

  it("cobrança avulsa usa a descrição; sem link fica sem o traço final", () => {
    const avulsa = parcela({ parcela_numero: null, descricao: "Honorários iniciais", link_fatura: null, link_boleto: null });
    expect(linhaDaParcela(avulsa, "2026-09-14")).toBe(`• Honorários iniciais — ${dinheiro(620)} (valor original) — venceu em 10/09/2026`);
  });
});

describe("resultadoDoLog — o que a trava registra", () => {
  const disparo = { candidatas: 1, foraDoEscopo: 0, executadas: 1 };
  it("concluída com send_message ok = enviado; barrada e falhou vêm do desfecho; concluída sem envio = barrada", () => {
    expect(resultadoDoLog({ desfecho: "concluida", steps_executed: [{ step_type: "send_message", status: "success" }] }, disparo)).toBe("enviado");
    expect(resultadoDoLog({ desfecho: "barrada", steps_executed: [] }, disparo)).toBe("barrada");
    expect(resultadoDoLog({ desfecho: "falhou", steps_executed: [{ step_type: "send_message", status: "failed" }] }, disparo)).toBe("falhou");
    // o envio SAIU e um passo posterior estourou: é `enviado` — a mensagem chegou ao cliente e conta para o intervalo (Codex, PR #206)
    expect(resultadoDoLog({ desfecho: "falhou", steps_executed: [{ step_type: "send_message", status: "success" }, { step_type: "add_tag", status: "failed" }] }, disparo)).toBe("enviado");
    expect(resultadoDoLog({ desfecho: "concluida", steps_executed: [{ step_type: "add_tag", status: "success" }] }, disparo)).toBe("barrada");
  });
  it("sem desfecho: enviou = enviado (o processo morreu depois do envio); senão incerto", () => {
    expect(resultadoDoLog({ desfecho: null, steps_executed: [{ step_type: "send_message", status: "success" }] }, disparo)).toBe("enviado");
    expect(resultadoDoLog({ desfecho: null, steps_executed: [] }, disparo)).toBe("incerto");
  });
  it("`na_fila`: sem desfecho, sem envio e com o disparo em espera — o motor reenfileirou o passo (PR #205); com envio registrado continua `enviado`", () => {
    const emEspera = { candidatas: 1, foraDoEscopo: 0, executadas: 1, emEspera: 1 };
    expect(resultadoDoLog({ desfecho: null, steps_executed: [{ step_type: "send_message", status: "failed" }] }, emEspera)).toBe("na_fila");
    expect(resultadoDoLog({ desfecho: null, steps_executed: [{ step_type: "send_message", status: "success" }] }, emEspera)).toBe("enviado");
    // o desfecho gravado vence a espera: a retentativa já rodou
    expect(resultadoDoLog({ desfecho: "falhou", steps_executed: [{ step_type: "send_message", status: "failed" }] }, emEspera)).toBe("falhou");
    expect(RESULTADOS_DA_TRAVA).toContain("na_fila");
  });
  it("sem log: fora do escopo, sem automação, ou incerto quando o motor diz que executou", () => {
    expect(resultadoDoLog(null, { candidatas: 0, foraDoEscopo: 0, executadas: 0 })).toBe("sem_automacao");
    expect(resultadoDoLog(null, { candidatas: 1, foraDoEscopo: 1, executadas: 0 })).toBe("fora_do_escopo");
    expect(resultadoDoLog(null, { candidatas: 1, foraDoEscopo: 0, executadas: 1 })).toBe("incerto");
  });
});

// ============================================================
// A aba Cobranças pede o desfecho da trava por chave MONTADA
// (`Inbox.cobrancas.regua.resultado.<resultado>`), fora do alcance do portão
// estático de i18n — os NOVE valores do CHECK da 998 (`RESULTADOS_DA_TRAVA`,
// em `regua.ts`) têm de existir nos dois dicionários, senão a aba imprime a
// chave crua.
// ============================================================
import { readFileSync } from "node:fs";


describe.each(["pt-BR.json", "en.json"])("dicionário %s — os resultados da régua", (arquivo) => {
  it("CRÍTICO: todo resultado da trava tem frase, e o lembrete e o marco também", () => {
    const bruto = JSON.parse(readFileSync(`messages/${arquivo}`, "utf8"));
    const regua = bruto.Inbox.cobrancas.regua as Record<string, unknown>;
    const resultado = (regua?.resultado ?? {}) as Record<string, unknown>;
    expect(RESULTADOS_DA_TRAVA.filter((r) => typeof resultado[r] !== "string")).toEqual([]);
    expect(typeof regua.lembrete).toBe("string");
    expect(typeof regua.marco).toBe("string");
  });
});
