/**
 * O cartão "Calendly" da aba Integrações, montado a partir da linha de
 * config (SEM segredos — a rota já a devolve sem token, chave e token de
 * webhook) e dos últimos eventos recebidos. Puro.
 */

export interface ConfigDoCalendly {
  user_name: string | null;
  user_email: string | null;
  scheduling_url: string | null;
  webhook_uri: string | null;
  webhook_scope: string | null;
  webhook_state: string | null;
  pergunta_telefone: string | null;
  status: string;
  last_event_at: string | null;
  last_error: string | null;
}

export type ResultadoDoEvento =
  | "recebido"
  | "disparado"
  /** a automação parou num passo "Aguardar"; o resto fica no histórico dela (978) */
  | "em_espera"
  /** reunião cancelada no Calendly: os lembretes daquele horário foram desarmados (1013) */
  | "cancelado"
  | "sem_automacao"
  | "sem_contato"
  | "sem_telefone"
  | "ignorado"
  | "falhou";

export interface EventoDoCalendly {
  id: string;
  evento: string;
  nome: string | null;
  email?: string | null;
  telefone: string | null;
  telefone_origem: string | null;
  event_type_nome: string | null;
  inicio: string | null;
  fim?: string | null;
  link?: string | null;
  perguntas?: { pergunta: string; resposta: string }[] | null;
  contact_id: string | null;
  resultado: ResultadoDoEvento | string;
  detalhe: string | null;
  recebido_em: string;
  processado_em?: string | null;
}

export type EstadoDoCalendly = "nao_conectado" | "conectado" | "erro";

export interface CartaoDoCalendly {
  estado: EstadoDoCalendly;
  usuario: { nome: string; email: string; agenda: string | null } | null;
  /** `null` = conectado mas sem assinatura de webhook de pé (precisa reassinar). */
  webhook: { escopo: string; estado: string } | null;
  perguntaTelefone: string | null;
  ultimoEvento: string | null;
  /** código do último erro (a tela traduz) */
  erro: string | null;
  contagem: Record<ResultadoDoEvento, number>;
}

export function cartaoDoCalendly(config: ConfigDoCalendly | null, eventos: readonly EventoDoCalendly[]): CartaoDoCalendly {
  const contagem: Record<ResultadoDoEvento, number> = {
    recebido: 0,
    disparado: 0,
    em_espera: 0,
    cancelado: 0,
    sem_automacao: 0,
    sem_contato: 0,
    sem_telefone: 0,
    ignorado: 0,
    falhou: 0,
  };
  for (const e of eventos) {
    if (e.resultado in contagem) contagem[e.resultado as ResultadoDoEvento] += 1;
  }
  if (!config) {
    return { estado: "nao_conectado", usuario: null, webhook: null, perguntaTelefone: null, ultimoEvento: null, erro: null, contagem };
  }
  const semWebhook = !config.webhook_uri || config.webhook_state === "disabled";
  return {
    estado: config.status === "erro" || semWebhook ? "erro" : "conectado",
    usuario: { nome: config.user_name ?? "", email: config.user_email ?? "", agenda: config.scheduling_url },
    webhook: config.webhook_uri ? { escopo: config.webhook_scope ?? "organization", estado: config.webhook_state ?? "active" } : null,
    perguntaTelefone: config.pergunta_telefone,
    ultimoEvento: config.last_event_at,
    erro: config.status === "erro" ? config.last_error : semWebhook ? "webhook_desativado" : null,
    contagem,
  };
}
