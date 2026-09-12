/**
 * A RÉGUA da inadimplência — pura, sem I/O. Uma régua só para todos os
 * lugares que dizem "este cliente deve" (a lista do cartão, o ícone da
 * linha, a faixa do compositor, a aba Cobranças, o filtro e a régua de
 * cobrança), pelo mesmo motivo de `atrasoDeResposta` alimentar o selo E o
 * chip: duas réguas divergiriam e o operador leria "o aviso sumiu".
 *
 * ⚠️ "Está vencida" é o `status` do Asaas, NUNCA `vencimento < hoje`: o
 * instante em que o Asaas vira `PENDING` em `OVERDUE` não está documentado
 * (C7 do plano), e um boleto de sábado pode ser pago na segunda sem multa.
 *
 * ⚠️ Os dias de atraso NÃO são gravados em lugar nenhum: são a diferença, em
 * dias de CALENDÁRIO, entre o vencimento e o dia de hoje no fuso do
 * escritório — calculada na leitura, como o `aguardando_desde` da 972. E o
 * vencimento nunca passa por `new Date("2026-09-01")`, que é meia-noite UTC
 * e retrocede um dia no Brasil: a aritmética é sobre o texto `AAAA-MM-DD`.
 */

import { diaNoFuso, FUSO_PADRAO } from "@/lib/agenda/fuso";
import { formatCurrency } from "@/lib/currency";

export type ClasseDaCobranca =
  | "vencida"
  | "negativada"
  | "paga"
  | "estornada"
  | "contestada"
  | "em_analise"
  | "a_vencer"
  | "apagada"
  | "desconhecida";

const PAGAS = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "DUNNING_RECEIVED"]);
const ESTORNADAS = new Set(["REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS"]);
const CONTESTADAS = new Set(["CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"]);

/**
 * O status CRU do Asaas → o que ele significa para o escritório. Status
 * novo (a doc avisa que pode aparecer) vira `desconhecida`, contada no
 * cartão — nunca derruba nada.
 */
export function classificar(status: string, deleted: boolean): ClasseDaCobranca {
  if (deleted) return "apagada";
  if (status === "OVERDUE") return "vencida";
  if (status === "DUNNING_REQUESTED") return "negativada";
  if (PAGAS.has(status)) return "paga";
  if (ESTORNADAS.has(status)) return "estornada";
  if (CONTESTADAS.has(status)) return "contestada";
  if (status === "AWAITING_RISK_ANALYSIS") return "em_analise";
  if (status === "PENDING") return "a_vencer";
  return "desconhecida";
}

/** A classe conta como dívida em aberto? (a negativada conta — D6) */
export function ehDevida(classe: ClasseDaCobranca): boolean {
  return classe === "vencida" || classe === "negativada";
}

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** `AAAA-MM-DD` → dias desde a época, sem fuso (aritmética de texto). */
function diaEmDias(dia: string): number | null {
  if (!RE_DIA.test(dia)) return null;
  const [a, m, d] = dia.split("-").map(Number);
  return Math.round(Date.UTC(a, m - 1, d) / 86_400_000);
}

/**
 * Dias de calendário entre o vencimento e HOJE no fuso do escritório.
 * Negativo quando o vencimento ainda não chegou (renegociada para a frente,
 * C9 — a tela diz "vencimento prorrogado"). `null` para texto que não é dia.
 */
export function diasDeAtraso(vencimento: string, agora: Date, fuso: string = FUSO_PADRAO): number | null {
  const v = diaEmDias(vencimento);
  const h = diaEmDias(diaNoFuso(agora, fuso));
  if (v === null || h === null) return null;
  return h - v;
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`, sem passar por `Date`. */
export function diaPorExtenso(dia: string): string {
  if (!RE_DIA.test(dia)) return dia;
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

export interface ParcelaDoEspelho {
  id: string;
  asaas_payment_id: string;
  asaas_customer_id: string;
  status: string;
  deleted: boolean;
  valor: number;
  juros_e_multa: number | null;
  /** `AAAA-MM-DD` */
  vencimento: string;
  vencimento_original: string | null;
  vista_vencida_em: string | null;
  pago_em: string | null;
  forma: string | null;
  pode_pagar_apos_vencimento: boolean | null;
  dias_ate_cancelar_registro: number | null;
  descricao: string | null;
  parcelamento_id: string | null;
  parcela_numero: number | null;
  parcela_total: number | null;
  link_fatura: string | null;
  link_boleto: string | null;
  /** ISO — a última listagem que a trouxe */
  visto_em: string;
}

/** "3/12"; "parcela 3" sem o total; a descrição quando a cobrança é avulsa. */
export function rotuloDaParcela(p: Pick<ParcelaDoEspelho, "parcela_numero" | "parcela_total" | "descricao">): string {
  if (p.parcela_numero !== null) {
    return p.parcela_total !== null ? `${p.parcela_numero}/${p.parcela_total}` : `parcela ${p.parcela_numero}`;
  }
  const descricao = p.descricao?.trim();
  return descricao && descricao !== "" ? descricao : "cobrança";
}

/** "3/12 e 4/12"; "3/12, 4/12, 5/12 e mais 2". */
export function rotulosDasParcelas(parcelas: readonly Pick<ParcelaDoEspelho, "parcela_numero" | "parcela_total" | "descricao">[], teto = 3): string {
  const rotulos = parcelas.map(rotuloDaParcela);
  if (rotulos.length === 0) return "";
  if (rotulos.length === 1) return rotulos[0];
  if (rotulos.length <= teto) return `${rotulos.slice(0, -1).join(", ")} e ${rotulos[rotulos.length - 1]}`;
  return `${rotulos.slice(0, teto).join(", ")} e mais ${rotulos.length - teto}`;
}

/** O valor que o cliente deve HOJE por esta parcela: com juros quando o Asaas informou. */
export function valorAtualizado(p: Pick<ParcelaDoEspelho, "valor" | "juros_e_multa">): number {
  return Math.round((p.valor + (p.juros_e_multa ?? 0)) * 100) / 100;
}

export interface ResumoDeDivida {
  /** as parcelas devidas VISTAS na última listagem completa, da mais antiga para a mais nova */
  vencidas: ParcelaDoEspelho[];
  /** devidas que NÃO voltaram na última listagem: podem ter sido pagas — ficam fora do total */
  emConferencia: ParcelaDoEspelho[];
  /** alguma das vencidas está negativada (D6) */
  negativada: boolean;
  /** soma dos valores originais das vencidas */
  total: number;
  /** soma com juros e multa, quando o Asaas informou */
  totalAtualizado: number;
  /** o vencimento MAIS ANTIGO em aberto — "inadimplente desde" */
  desde: string | null;
  /** dias de atraso da parcela mais antiga; `null` sem vencida */
  dias: number | null;
}

/**
 * A dívida de um cliente (ou de um contato: as parcelas de todos os clientes
 * do Asaas ligados a ele), a partir das linhas do espelho.
 *
 * ⚠️ `vencidasListadasEm` é o início da última listagem COMPLETA das
 * vencidas. Parcela devida com `visto_em` anterior a isso NÃO voltou na
 * listagem — pagou, foi apagada, renegociada — e fica "em conferência" até a
 * reconciliação relê-la: ela não entra no total, senão o aviso diria
 * "inadimplente" sobre quem pagou ontem.
 */
export function resumirDivida(parcelas: readonly ParcelaDoEspelho[], agora: Date, vencidasListadasEm: string | null, fuso: string = FUSO_PADRAO): ResumoDeDivida {
  const corte = vencidasListadasEm ? Date.parse(vencidasListadasEm) : null;
  const vencidas: ParcelaDoEspelho[] = [];
  const emConferencia: ParcelaDoEspelho[] = [];
  for (const p of parcelas) {
    if (!ehDevida(classificar(p.status, p.deleted))) continue;
    if (corte !== null && Date.parse(p.visto_em) < corte) emConferencia.push(p);
    else vencidas.push(p);
  }
  vencidas.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));
  emConferencia.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : 0));
  const total = Math.round(vencidas.reduce((s, p) => s + p.valor, 0) * 100) / 100;
  const totalAtualizado = Math.round(vencidas.reduce((s, p) => s + valorAtualizado(p), 0) * 100) / 100;
  const desde = vencidas[0]?.vencimento ?? null;
  return {
    vencidas,
    emConferencia,
    negativada: vencidas.some((p) => classificar(p.status, p.deleted) === "negativada"),
    total,
    totalAtualizado,
    desde,
    dias: desde ? diasDeAtraso(desde, agora, fuso) : null,
  };
}

/** "R$ 1.240,00", pela mesma função do resto do app (pt-BR fixo). */
export function dinheiro(valor: number): string {
  return formatCurrency(valor);
}

/** A faixa de atraso da lista de inadimplentes do cartão. */
export type FaixaDeAtraso = "ate_5" | "de_6_a_30" | "mais_de_30";

export function faixaDeAtraso(dias: number): FaixaDeAtraso {
  if (dias <= 5) return "ate_5";
  if (dias <= 30) return "de_6_a_30";
  return "mais_de_30";
}
