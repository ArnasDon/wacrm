import { digitosDoTelefone, pareceTelefone } from "@/lib/contacts/telefone";

/**
 * O payload do webhook `invitee.created` do Calendly, normalizado para o que
 * o CRM precisa. Puro: recebe o JSON cru (já verificado pela assinatura) e
 * devolve um `Agendamento`, ou `null` quando o corpo não é um agendamento
 * (outro evento, forma inesperada).
 *
 * ⚠️ O TELEFONE é a parte que decide tudo (é por ele que o cliente é
 * achado), e o Calendly não tem campo para ele. Três fontes, nesta ordem
 * (D1 do plano):
 *   1. `text_reminder_number` — o lembrete por SMS, quando o evento o pede;
 *      chega com DDI.
 *   2. A pergunta do formulário cujo rótulo o operador informou no cartão
 *      da integração ("WhatsApp", "Telefone"…), comparada sem acento e sem
 *      caixa, por trecho.
 *   3. Heurística: uma pergunta cujo rótulo fala de telefone/WhatsApp com
 *      resposta que parece telefone; senão, a primeira resposta que parece
 *      telefone.
 * A ORIGEM fica registrada no agendamento — é o que a tela mostra quando o
 * contato não é achado, para o operador saber de onde o número saiu.
 */

export const EVENTO_AGENDADO = "invitee.created";

/**
 * O cancelamento (1013). Assinado desde 20/09/2026 por um motivo estreito: é
 * ele que DESARMA os lembretes de reunião. Sem ele o CRM não sabia que a
 * reunião caiu, a data continuava no campo do contato, e os quatro lembretes
 * saíam do mesmo jeito — inclusive "sua reunião começa em 10 minutos", com o
 * link de um evento cancelado.
 *
 * ⚠️ REAGENDAR TAMBÉM CANCELA. O Calendly desfaz o invitee antigo e cria um
 * novo, então um `invitee.canceled` de reagendamento chega junto com o
 * `invitee.created` do horário novo — e a ORDEM entre os dois não é
 * garantida. Por isso `reagendado` existe aqui, e por isso quem processa
 * confere também o VALOR gravado na ficha antes de desarmar.
 */
export const EVENTO_CANCELADO = "invitee.canceled";

export interface PerguntaRespondida {
  pergunta: string;
  resposta: string;
}

export type OrigemDoTelefone = "sms" | "pergunta" | "heuristica";

export interface Agendamento {
  evento: typeof EVENTO_AGENDADO;
  /** `payload.uri` — a chave de idempotência (o Calendly reenvia). */
  inviteeUri: string;
  nome: string;
  email: string | null;
  /** No formato de `contacts.phone` (só dígitos, com DDI), ou null. */
  telefone: string | null;
  telefoneOrigem: OrigemDoTelefone | null;
  /** `scheduled_event.event_type` — a URI do TIPO de evento (o filtro do gatilho). */
  eventoUri: string | null;
  /** `scheduled_event.name` — "Reunião com Advogado - Kommo". */
  eventoNome: string | null;
  eventoAgendadoUri: string | null;
  /** ISO 8601 em UTC, como o Calendly manda. */
  inicio: string | null;
  fim: string | null;
  /** Link de videoconferência (`location.join_url`), ou o local quando é uma URL. */
  link: string | null;
  local: string | null;
  cancelarUrl: string | null;
  remarcarUrl: string | null;
  /** Este invitee substitui outro (`old_invitee` preenchido). */
  reagendado: boolean;
  fusoDoConvidado: string | null;
  perguntas: PerguntaRespondida[];
}

export interface OpcoesDeLeitura {
  /** Rótulo (ou trecho) da pergunta do formulário que carrega o telefone. */
  perguntaTelefone?: string | null;
}

function objeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function ehUrl(v: string | null): v is string {
  return !!v && /^https?:\/\//i.test(v);
}

/** Sem acento, sem caixa, aparado — para comparar rótulos de pergunta. */
export function normalizarRotulo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .trim();
}

const RE_PERGUNTA_DE_TELEFONE = /telefone|whatsapp|celular|phone|contato|fone/;
/**
 * Rótulos que carregam número mas NÃO telefone. Um CPF tem 11 dígitos — os
 * mesmos de um celular sem DDI — e formulário de escritório de advocacia
 * pergunta CPF. Sem esta lista a heurística mandava o aviso da reunião
 * para um CPF, e "sem contato" viraria a resposta certa com o motivo errado.
 */
const RE_PERGUNTA_QUE_NAO_E_TELEFONE = /cpf|cnpj|\brg\b|documento|identidade|\bcep\b|valor|processo|protocolo|conta|agencia|cart[a]o|matricula|pedido/;
/** CPF/CNPJ escritos com a pontuação usual — não são telefone, seja qual for o rótulo. */
const RE_DOCUMENTO_FORMATADO = /^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;

/** Qual `event` este corpo carrega (`invitee.created`, `invitee.canceled`…). */
export function eventoDoCorpo(corpo: unknown): string | null {
  const o = objeto(corpo);
  return o ? texto(o.event) : null;
}

export function lerPerguntas(payload: Record<string, unknown>): PerguntaRespondida[] {
  const lista = Array.isArray(payload.questions_and_answers) ? payload.questions_and_answers : [];
  const saida: PerguntaRespondida[] = [];
  for (const item of lista) {
    const q = objeto(item);
    if (!q) continue;
    const pergunta = texto(q.question);
    const resposta = texto(q.answer);
    if (pergunta && resposta) saida.push({ pergunta, resposta });
  }
  return saida;
}

export function telefoneDoAgendamento(
  payload: Record<string, unknown>,
  perguntas: PerguntaRespondida[],
  perguntaTelefone?: string | null,
): { telefone: string | null; origem: OrigemDoTelefone | null } {
  const sms = digitosDoTelefone(texto(payload.text_reminder_number));
  if (sms) return { telefone: sms, origem: "sms" };

  const rotulo = perguntaTelefone ? normalizarRotulo(perguntaTelefone) : "";
  if (rotulo) {
    const escolhida = perguntas.find((p) => normalizarRotulo(p.pergunta).includes(rotulo));
    const digitos = escolhida ? digitosDoTelefone(escolhida.resposta) : null;
    if (digitos) return { telefone: digitos, origem: "pergunta" };
  }

  const comRotulo = perguntas.find(
    (p) => RE_PERGUNTA_DE_TELEFONE.test(normalizarRotulo(p.pergunta)) && pareceTelefone(p.resposta),
  );
  const qualquer =
    comRotulo ??
    perguntas.find(
      (p) =>
        !RE_PERGUNTA_QUE_NAO_E_TELEFONE.test(normalizarRotulo(p.pergunta)) &&
        !RE_DOCUMENTO_FORMATADO.test(p.resposta.trim()) &&
        pareceTelefone(p.resposta),
    );
  const digitos = qualquer ? digitosDoTelefone(qualquer.resposta) : null;
  if (digitos) return { telefone: digitos, origem: "heuristica" };

  return { telefone: null, origem: null };
}

export function lerAgendamento(corpo: unknown, opcoes: OpcoesDeLeitura = {}): Agendamento | null {
  const raiz = objeto(corpo);
  if (!raiz || raiz.event !== EVENTO_AGENDADO) return null;
  const payload = objeto(raiz.payload);
  if (!payload) return null;
  const inviteeUri = texto(payload.uri);
  const nome = texto(payload.name) ?? [texto(payload.first_name), texto(payload.last_name)].filter(Boolean).join(" ");
  if (!inviteeUri || !nome) return null;

  const evento = objeto(payload.scheduled_event);
  const location = evento ? objeto(evento.location) : null;
  const joinUrl = location ? texto(location.join_url) : null;
  const localTexto = location ? texto(location.location) : null;

  const perguntas = lerPerguntas(payload);
  const { telefone, origem } = telefoneDoAgendamento(payload, perguntas, opcoes.perguntaTelefone);

  return {
    evento: EVENTO_AGENDADO,
    inviteeUri,
    nome,
    email: texto(payload.email),
    telefone,
    telefoneOrigem: origem,
    eventoUri: evento ? texto(evento.event_type) : null,
    eventoNome: evento ? texto(evento.name) : null,
    eventoAgendadoUri: evento ? texto(evento.uri) : null,
    inicio: evento ? texto(evento.start_time) : null,
    fim: evento ? texto(evento.end_time) : null,
    link: ehUrl(joinUrl) ? joinUrl : ehUrl(localTexto) ? localTexto : null,
    local: localTexto ?? (location ? texto(location.type) : null),
    cancelarUrl: texto(payload.cancel_url),
    remarcarUrl: texto(payload.reschedule_url),
    reagendado: !!texto(payload.old_invitee),
    fusoDoConvidado: texto(payload.timezone),
    perguntas,
  };
}

export interface Cancelamento {
  evento: typeof EVENTO_CANCELADO;
  /** `payload.uri` — o MESMO invitee do agendamento, e a chave do log. */
  inviteeUri: string;
  nome: string | null;
  email: string | null;
  /**
   * `scheduled_event.start_time` da reunião que caiu. É a chave do desarme:
   * só se desarma o lembrete cujo valor gravado na ficha for este instante.
   */
  inicio: string | null;
  eventoUri: string | null;
  eventoNome: string | null;
  /**
   * O cliente REAGENDOU (não desistiu): o Calendly marca `rescheduled` e/ou
   * aponta `new_invitee`. Aqui não se desarma nada — o horário novo chega no
   * `invitee.created` do invitee novo, que re-arma a trava sozinho (a chave
   * da 935 inclui o VALOR).
   */
  reagendado: boolean;
  /** `cancellation.reason`, quando o cliente escreve um motivo. */
  motivo: string | null;
}

/**
 * Lê o corpo de um `invitee.canceled`. Puro, e separado de `lerAgendamento`
 * de propósito: o `Agendamento` carrega telefone, perguntas e variáveis que
 * um cancelamento não usa, e alargá-lo faria o caminho do agendamento
 * responder por um evento que ele não trata.
 */
export function lerCancelamento(corpo: unknown): Cancelamento | null {
  const raiz = objeto(corpo);
  if (!raiz || raiz.event !== EVENTO_CANCELADO) return null;
  const payload = objeto(raiz.payload);
  if (!payload) return null;
  const inviteeUri = texto(payload.uri);
  if (!inviteeUri) return null;

  const evento = objeto(payload.scheduled_event);
  const cancelamento = objeto(payload.cancellation);

  return {
    evento: EVENTO_CANCELADO,
    inviteeUri,
    nome: texto(payload.name) ?? texto([texto(payload.first_name), texto(payload.last_name)].filter(Boolean).join(" ")),
    email: texto(payload.email),
    inicio: evento ? texto(evento.start_time) : null,
    eventoUri: evento ? texto(evento.event_type) : null,
    eventoNome: evento ? texto(evento.name) : null,
    // Os dois sinais, porque nenhum é garantido: `rescheduled` é o booleano
    // do invitee, `new_invitee` é para onde ele foi.
    reagendado: payload.rescheduled === true || !!texto(payload.new_invitee),
    motivo: cancelamento ? texto(cancelamento.reason) : null,
  };
}
