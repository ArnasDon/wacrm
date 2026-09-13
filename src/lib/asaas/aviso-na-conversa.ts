/**
 * O AVISO de inadimplência na conversa (Fase 1b do plano, §3.5) — a parte
 * pura: o que as duas rotas de leitura devolvem, como o navegador lê isso
 * (campo a campo, nunca `as`) e como reparte as parcelas de um contato.
 *
 * ⚠️ `null` de leitura é "não sei", nunca "em dia": a faixa cala, o ícone
 * não aparece, o filtro é neutralizado. É a régua de `lerResumo` das
 * execuções (985): corpo estranho vira "não sei", e não vazio.
 */

import { diaNoFuso, FUSO_PADRAO } from "@/lib/agenda/fuso";

import { classificar, resumirDivida, type ParcelaDoEspelho, type ResumoDeDivida } from "./inadimplencia";

export interface RespostaDoResumo {
  conectado: boolean;
  /** a última listagem completa das vencidas é recente (duas voltas do laço lento) */
  leituraFresca: boolean;
  /** ISO do início da última listagem completa — "dados do Asaas de …" */
  atualizadoEm: string | null;
  /** contato → as parcelas DEVIDAS (vencidas e negativadas) dos clientes do Asaas ligados a ele */
  contatos: Record<string, ParcelaDoEspelho[]>;
}

const CAMPOS_DA_PARCELA: (keyof ParcelaDoEspelho)[] = ["id", "asaas_payment_id", "asaas_customer_id", "status", "vencimento", "visto_em"];

function lerParcelaSolta(v: unknown): ParcelaDoEspelho | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  for (const campo of CAMPOS_DA_PARCELA) if (typeof o[campo] !== "string") return null;
  if (typeof o.valor !== "number") return null;
  return {
    id: o.id as string,
    asaas_payment_id: o.asaas_payment_id as string,
    asaas_customer_id: o.asaas_customer_id as string,
    status: o.status as string,
    deleted: o.deleted === true,
    valor: o.valor,
    juros_e_multa: typeof o.juros_e_multa === "number" ? o.juros_e_multa : null,
    vencimento: o.vencimento as string,
    vencimento_original: typeof o.vencimento_original === "string" ? o.vencimento_original : null,
    vista_vencida_em: typeof o.vista_vencida_em === "string" ? o.vista_vencida_em : null,
    pago_em: typeof o.pago_em === "string" ? o.pago_em : null,
    forma: typeof o.forma === "string" ? o.forma : null,
    pode_pagar_apos_vencimento: typeof o.pode_pagar_apos_vencimento === "boolean" ? o.pode_pagar_apos_vencimento : null,
    dias_ate_cancelar_registro: typeof o.dias_ate_cancelar_registro === "number" ? o.dias_ate_cancelar_registro : null,
    descricao: typeof o.descricao === "string" ? o.descricao : null,
    parcelamento_id: typeof o.parcelamento_id === "string" ? o.parcelamento_id : null,
    parcela_numero: typeof o.parcela_numero === "number" ? o.parcela_numero : null,
    parcela_total: typeof o.parcela_total === "number" ? o.parcela_total : null,
    link_fatura: typeof o.link_fatura === "string" ? o.link_fatura : null,
    link_boleto: typeof o.link_boleto === "string" ? o.link_boleto : null,
    visto_em: o.visto_em as string,
  };
}

/** Parse DEFENSIVO do corpo da rota `/api/cb/asaas/resumo`. Corpo estranho → `null` ("não sei"). */
export function lerRespostaDoResumo(json: unknown): RespostaDoResumo | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.conectado !== "boolean" || typeof o.leituraFresca !== "boolean") return null;
  const contatos: Record<string, ParcelaDoEspelho[]> = {};
  if (o.contatos && typeof o.contatos === "object" && !Array.isArray(o.contatos)) {
    for (const [id, lista] of Object.entries(o.contatos as Record<string, unknown>)) {
      if (!Array.isArray(lista)) continue;
      const parcelas = lista.map(lerParcelaSolta).filter((p): p is ParcelaDoEspelho => p !== null);
      if (parcelas.length > 0) contatos[id] = parcelas;
    }
  }
  return {
    conectado: o.conectado,
    leituraFresca: o.leituraFresca,
    atualizadoEm: typeof o.atualizadoEm === "string" ? o.atualizadoEm : null,
    contatos,
  };
}

/**
 * A dívida de cada contato, só de quem tem parcela VENCIDA vista na última
 * listagem completa — é o que acende o ícone da linha e a faixa.
 */
export function dividasPorContato(resumo: RespostaDoResumo, agora: Date): Map<string, ResumoDeDivida> {
  const mapa = new Map<string, ResumoDeDivida>();
  for (const [id, parcelas] of Object.entries(resumo.contatos)) {
    const divida = resumirDivida(parcelas, agora, resumo.atualizadoEm);
    if (divida.vencidas.length > 0) mapa.set(id, divida);
  }
  return mapa;
}

/**
 * A dívida de UM contato (a faixa do fio), ou `null` quando ele não deve —
 * ou quando ainda não se sabe (`resumo` nulo). Grupo não tem contato e cai
 * no `null` sozinho.
 */
export function dividaDoContato(resumo: RespostaDoResumo | null, contactId: string | null | undefined, agora: Date): ResumoDeDivida | null {
  if (!resumo || !contactId) return null;
  const parcelas = resumo.contatos[contactId];
  if (!parcelas || parcelas.length === 0) return null;
  const divida = resumirDivida(parcelas, agora, resumo.atualizadoEm);
  return divida.vencidas.length > 0 ? divida : null;
}

/**
 * O conjunto do FILTRO "Inadimplentes": `null` neutraliza (desconectado, ou
 * ainda não se sabe) — a lista nunca responde "nenhuma conversa" sobre dado
 * que não existe.
 *
 * ⚠️ Leitura ANTIGA (espelho parado) NÃO neutraliza: é a MESMA régua do
 * ícone da linha — um interruptor que cala em silêncio sobre dado velho
 * deixaria o operador com 15 ícones na lista e um filtro que "não faz
 * nada". A resposta é a última listagem, e a tela diz de quando ela é
 * (o interruptor mostra "dados do Asaas de …" quando não é fresca).
 */
export function idsInadimplentes(resumo: RespostaDoResumo | null, agora: Date): Set<string> | null {
  if (!resumo || !resumo.conectado) return null;
  return new Set(dividasPorContato(resumo, agora).keys());
}

export interface ClienteLigadoAoContato {
  /** o id da linha de `cb_asaas_clientes` — é o que a ação "Não é este cliente" desliga */
  id: string;
  asaasId: string;
  nome: string;
  origem: string | null;
  notificacoesDesligadas: boolean;
}

export interface RespostaDoContato {
  conectado: boolean;
  leituraFresca: boolean;
  atualizadoEm: string | null;
  clientes: ClienteLigadoAoContato[];
  /** todas as parcelas do espelho dos clientes ligados (devidas, pagas, estornadas…) */
  parcelas: ParcelaDoEspelho[];
}

export function lerRespostaDoContato(json: unknown): RespostaDoContato | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.conectado !== "boolean" || typeof o.leituraFresca !== "boolean") return null;
  const clientes: ClienteLigadoAoContato[] = [];
  if (Array.isArray(o.clientes)) {
    for (const c of o.clientes) {
      if (!c || typeof c !== "object") continue;
      const k = c as Record<string, unknown>;
      if (typeof k.id !== "string" || typeof k.asaasId !== "string") continue;
      clientes.push({
        id: k.id,
        asaasId: k.asaasId,
        nome: typeof k.nome === "string" ? k.nome : "",
        origem: typeof k.origem === "string" ? k.origem : null,
        notificacoesDesligadas: k.notificacoesDesligadas === true,
      });
    }
  }
  const parcelas = Array.isArray(o.parcelas) ? o.parcelas.map(lerParcelaSolta).filter((p): p is ParcelaDoEspelho => p !== null) : [];
  return {
    conectado: o.conectado,
    leituraFresca: o.leituraFresca,
    atualizadoEm: typeof o.atualizadoEm === "string" ? o.atualizadoEm : null,
    clientes,
    parcelas,
  };
}

/** Quantos dias uma parcela paga ainda aparece em "Regularizadas". */
export const REGULARIZADAS_DIAS = 30;

export interface ParcelasDoContato {
  divida: ResumoDeDivida;
  /** pagas nos últimos `REGULARIZADAS_DIAS` dias, mais recentes primeiro */
  regularizadas: ParcelaDoEspelho[];
  /** estornadas ou contestadas — "o valor voltou ao cliente" */
  estornadas: ParcelaDoEspelho[];
  /** a que vence HOJE (D17): a vencer, sem dívida ainda */
  aVencer: ParcelaDoEspelho[];
}

function diaDaParcela(p: ParcelaDoEspelho): string {
  return p.pago_em ?? p.visto_em.slice(0, 10);
}

export function separarParcelas(parcelas: readonly ParcelaDoEspelho[], agora: Date, vencidasListadasEm: string | null, fuso: string = FUSO_PADRAO): ParcelasDoContato {
  const divida = resumirDivida(parcelas, agora, vencidasListadasEm, fuso);
  const hojeLocal = diaNoFuso(agora, fuso);
  const regularizadas: ParcelaDoEspelho[] = [];
  const estornadas: ParcelaDoEspelho[] = [];
  const aVencer: ParcelaDoEspelho[] = [];
  // ⚠️ O corte é o DIA no fuso do escritório, como `hojeLocal` e os dias de
  // atraso — `toISOString()` daria o dia UTC, que das 21h à meia-noite já é
  // o seguinte, e tiraria de "regularizadas" a parcela paga há exatos 30
  // dias (Codex, PR #203).
  const corte = diaNoFuso(new Date(agora.getTime() - REGULARIZADAS_DIAS * 86_400_000), fuso);
  for (const p of parcelas) {
    const classe = classificar(p.status, p.deleted);
    if (classe === "paga" && diaDaParcela(p) >= corte) regularizadas.push(p);
    else if (classe === "estornada" || classe === "contestada") estornadas.push(p);
    else if (classe === "a_vencer" && p.vencimento >= hojeLocal) aVencer.push(p);
  }
  regularizadas.sort((a, b) => (diaDaParcela(a) < diaDaParcela(b) ? 1 : -1));
  return { divida, regularizadas, estornadas, aVencer };
}
