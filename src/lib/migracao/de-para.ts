// ============================================================
// O de-para da migração Kommo → CB CRM: de qual etapa da Kommo o lead vem e
// em qual etapa daqui ele pousa. É DADO, e mora em código para ter teste.
//
// A fonte humana é `docs/PLANO-migracao-kommo-de-para.md`; este arquivo é a
// versão executável dela, e o teste ao lado cobra que as duas concordem.
//
// ⚠️⚠️ A CHAVE É `(pipeline_id, status_id)`, NUNCA `status_id` sozinho.
// Na Kommo, **142 (ganho) e 143 (perdido) são status GLOBAIS**: existem nos
// SEIS funis, com o mesmo id. Um mapa chaveado só pelo status guarda o ÚLTIMO
// funil que o definiu e manda o lead perdido do Bancário para o funil do
// Trabalhista — sem erro, sem log, e pousando numa etapa que existe. Medido em
// 21/09: 143 se reparte em 2.924 (Pré Vendas) + 2.719 (Trabalhista) + 57
// (Closer) + 1 (Onboarding); 142 são 171, todos do Trabalhista. O bug já foi
// cometido uma vez, no script que escolheu os leads do piloto.
// ============================================================

/** Os funis de DESTINO, exatamente como se chamam no CB CRM. */
export const FUNIS_DE_DESTINO = [
  "Trabalhista - Comercial",
  "Trabalhista - Jurídico",
  "Bancário - Comercial",
  "Bancário - Jurídico",
] as const;

export type FunilDeDestino = (typeof FUNIS_DE_DESTINO)[number];

/**
 * As 34 etapas de destino, por funil e na ordem em que estão no quadro.
 * Conferido contra a produção em 21/09, depois da fase 2c.
 */
export const ETAPAS_DE_DESTINO: Record<FunilDeDestino, readonly string[]> = {
  "Trabalhista - Comercial": [
    "Entrada Avulsa",
    "Entrada Anuncios",
    "Ag. Demissão",
    "Pediu Demissão",
    "Foi Demitido",
    "Qualificado",
    "Link Enviado",
    "Contrato Assinado",
    "Protocolado",
    "Não Respondeu",
    "Desqualificado - Sem Direito",
    "Perdido",
  ],
  "Trabalhista - Jurídico": [
    "Avulso",
    "Pendente Documento",
    "Em Elaboração",
    "Cliente Ativo",
    "Cliente Finalizado",
    "Contato de Emergência",
    "Contato Acordo",
  ],
  "Bancário - Comercial": [
    "Contato Avulso",
    "Desqualificado",
    "Lead - Type e Forms",
    "MQL 1 - Recebeu Link",
    "Reunião Agendada",
    "MQL 2 - Reunião Qualificada",
    "No Show",
    "Reunião Sem Proposta",
    "Proposta Realizada",
    "Contrato Fechado",
    "Perdido",
  ],
  "Bancário - Jurídico": [
    "Contato Avulso",
    "Cliente Ativo",
    "Cliente Inativo",
    "Contato Banco",
  ],
};

/** Os funis da Kommo, pelo id. */
export const FUNIS_DA_KOMMO = {
  preVendas: 11314459,
  closer: 11366495,
  onboarding: 11346503,
  checkpoints: 11346511,
  juridico: 11366523,
  trabalhista: 11350967,
} as const;

/** Status GLOBAIS da Kommo — existem em todo funil. */
export const GANHO_NA_KOMMO = 142;
export const PERDIDO_NA_KOMMO = 143;

export interface DestinoDoLead {
  funil: FunilDeDestino;
  etapa: string;
}

/** Uma entrada do de-para, com o que ela vale hoje (para o teste conferir). */
interface LinhaDoDePara extends DestinoDoLead {
  /** Nome da etapa na Kommo — só para leitura humana e mensagem de erro. */
  origem: string;
  /** Leads vivos nesta etapa em 19/09/2026, do levantamento. */
  leads: number;
}

const chave = (pipelineId: number, statusId: number) => `${pipelineId}:${statusId}`;

const K = FUNIS_DA_KOMMO;

/**
 * O mapa inteiro. Toda etapa da Kommo COM lead precisa estar aqui — a carga
 * aborta no que não estiver, em vez de adivinhar (é a mesma disciplina da
 * regra 22 para os campos personalizados).
 */
export const DE_PARA: Readonly<Record<string, LinhaDoDePara>> = {
  // ---------- Trabalhista (Kommo) → Trabalhista - Comercial ----------
  [chave(K.trabalhista, 89326403)]: { origem: "Etapa de entrada", funil: "Trabalhista - Comercial", etapa: "Entrada Avulsa", leads: 344 },
  [chave(K.trabalhista, 87130431)]: { origem: "Ag. Demissão", funil: "Trabalhista - Comercial", etapa: "Ag. Demissão", leads: 887 },
  [chave(K.trabalhista, 87130435)]: { origem: "Pediu Demissão", funil: "Trabalhista - Comercial", etapa: "Pediu Demissão", leads: 1155 },
  [chave(K.trabalhista, 87960611)]: { origem: "Foi demitido", funil: "Trabalhista - Comercial", etapa: "Foi Demitido", leads: 411 },
  [chave(K.trabalhista, 87543703)]: { origem: "SUPER QUALIFICADO", funil: "Trabalhista - Comercial", etapa: "Qualificado", leads: 47 },
  [chave(K.trabalhista, 87130439)]: { origem: "Link enviado", funil: "Trabalhista - Comercial", etapa: "Link Enviado", leads: 158 },
  [chave(K.trabalhista, 87130443)]: { origem: "Contrato assinado", funil: "Trabalhista - Comercial", etapa: "Contrato Assinado", leads: 41 },
  [chave(K.trabalhista, 87130471)]: { origem: "Protocolado", funil: "Trabalhista - Comercial", etapa: "Protocolado", leads: 742 },
  [chave(K.trabalhista, 88618475)]: { origem: "Não respondeu 1ª mensagem", funil: "Trabalhista - Comercial", etapa: "Não Respondeu", leads: 1571 },
  [chave(K.trabalhista, 87129503)]: { origem: "Desqualificado - conferir", funil: "Trabalhista - Comercial", etapa: "Desqualificado - Sem Direito", leads: 15 },
  // Decisão 6 do operador: os 171 "Ganho" do Trabalhista vão para Protocolado.
  [chave(K.trabalhista, GANHO_NA_KOMMO)]: { origem: "Ganho", funil: "Trabalhista - Comercial", etapa: "Protocolado", leads: 171 },
  [chave(K.trabalhista, PERDIDO_NA_KOMMO)]: { origem: "descarte", funil: "Trabalhista - Comercial", etapa: "Perdido", leads: 2719 },
  [chave(K.trabalhista, 87129495)]: { origem: "Etapa de leads de entrada", funil: "Trabalhista - Comercial", etapa: "Entrada Avulsa", leads: 0 },

  // ---------- Trabalhista (Kommo) → Trabalhista - Jurídico ----------
  [chave(K.trabalhista, 92258515)]: { origem: "Contato avulso", funil: "Trabalhista - Jurídico", etapa: "Avulso", leads: 31 },
  [chave(K.trabalhista, 87130447)]: { origem: "pendente documento", funil: "Trabalhista - Jurídico", etapa: "Pendente Documento", leads: 75 },
  // Decisão 2: quem está em "documentos recebidos" pode ir para Em Elaboração.
  [chave(K.trabalhista, 87130463)]: { origem: "Em Elaboração", funil: "Trabalhista - Jurídico", etapa: "Em Elaboração", leads: 17 },
  [chave(K.trabalhista, 87130451)]: { origem: "documentos recebidos", funil: "Trabalhista - Jurídico", etapa: "Em Elaboração", leads: 23 },
  [chave(K.trabalhista, 92258015)]: { origem: "Contato acordo", funil: "Trabalhista - Jurídico", etapa: "Contato Acordo", leads: 35 },

  // ---------- Pré Vendas (SDR) → Bancário - Comercial ----------
  [chave(K.preVendas, 86842147)]: { origem: "Contato inicial", funil: "Bancário - Comercial", etapa: "Contato Avulso", leads: 2 },
  [chave(K.preVendas, 88066671)]: { origem: "DESQUALIFICADO", funil: "Bancário - Comercial", etapa: "Desqualificado", leads: 0 },
  [chave(K.preVendas, 91472495)]: { origem: "TYPEBOT e FORMS - Contato Inicial", funil: "Bancário - Comercial", etapa: "Lead - Type e Forms", leads: 255 },
  [chave(K.preVendas, 86862119)]: { origem: "Recebeu Link e não agendou", funil: "Bancário - Comercial", etapa: "MQL 1 - Recebeu Link", leads: 31 },
  [chave(K.preVendas, 92486259)]: { origem: "Recuperação com modelo waba", funil: "Bancário - Comercial", etapa: "MQL 1 - Recebeu Link", leads: 1 },
  [chave(K.preVendas, 86862127)]: { origem: "REUNIÃO Agendada BOT (Qualificar)", funil: "Bancário - Comercial", etapa: "Reunião Agendada", leads: 62 },
  [chave(K.preVendas, 87558047)]: { origem: "Reunião Agendada - Link avulso", funil: "Bancário - Comercial", etapa: "Reunião Agendada", leads: 6 },
  [chave(K.preVendas, 110874672)]: { origem: "Qualificado pós Agendamento", funil: "Bancário - Comercial", etapa: "MQL 2 - Reunião Qualificada", leads: 11 },
  // Decisão 5: No-show é REUNIÃO, sem resultado, marcado só com a etiqueta.
  [chave(K.preVendas, 90021863)]: { origem: "no-show - reagen manual", funil: "Bancário - Comercial", etapa: "No Show", leads: 91 },
  [chave(K.preVendas, 87072727)]: { origem: "No-Show - recuperar auto", funil: "Bancário - Comercial", etapa: "No Show", leads: 11 },
  [chave(K.preVendas, 92762567)]: { origem: "Fechar", funil: "Bancário - Comercial", etapa: "Proposta Realizada", leads: 1 },
  [chave(K.preVendas, GANHO_NA_KOMMO)]: { origem: "Fechado - ganho", funil: "Bancário - Comercial", etapa: "Contrato Fechado", leads: 0 },
  [chave(K.preVendas, PERDIDO_NA_KOMMO)]: { origem: "Fechado - perdido", funil: "Bancário - Comercial", etapa: "Perdido", leads: 2924 },
  [chave(K.preVendas, 86842143)]: { origem: "Etapa de leads de entrada", funil: "Bancário - Comercial", etapa: "Contato Avulso", leads: 0 },

  // ---------- Closer → Bancário - Comercial ----------
  [chave(K.closer, 87255227)]: { origem: "Reunião Sem Proposta", funil: "Bancário - Comercial", etapa: "Reunião Sem Proposta", leads: 20 },
  [chave(K.closer, 87255235)]: { origem: "reunião proposta - f.u manual", funil: "Bancário - Comercial", etapa: "Proposta Realizada", leads: 181 },
  [chave(K.closer, 87255231)]: { origem: "reunião proposta - f.u auto", funil: "Bancário - Comercial", etapa: "Proposta Realizada", leads: 77 },
  [chave(K.closer, 87256447)]: { origem: "Muito bom - muito quente", funil: "Bancário - Comercial", etapa: "Proposta Realizada", leads: 11 },
  [chave(K.closer, 87256463)]: { origem: "+ 30d - recup manual", funil: "Bancário - Comercial", etapa: "Proposta Realizada", leads: 5 },
  [chave(K.closer, 87256467)]: { origem: "Contrato fechado", funil: "Bancário - Comercial", etapa: "Contrato Fechado", leads: 1 },
  [chave(K.closer, GANHO_NA_KOMMO)]: { origem: "Venda ganha", funil: "Bancário - Comercial", etapa: "Contrato Fechado", leads: 0 },
  [chave(K.closer, PERDIDO_NA_KOMMO)]: { origem: "Venda perdida", funil: "Bancário - Comercial", etapa: "Perdido", leads: 57 },
  [chave(K.closer, 87255223)]: { origem: "Etapa de leads de entrada", funil: "Bancário - Comercial", etapa: "Contato Avulso", leads: 0 },

  // ---------- Onboarding → Bancário - Jurídico ----------
  // Decisão 3: documentos solicitados e docs com pendência vão para Cliente Ativo.
  [chave(K.onboarding, 87710135)]: { origem: "iniciar onboarding", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 52 },
  [chave(K.onboarding, 87721719)]: { origem: "documentos solicitados", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 36 },
  [chave(K.onboarding, 87095275)]: { origem: "docs com pendência", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 16 },
  [chave(K.onboarding, 87701431)]: { origem: "Onboarding Finalizado", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 78 },
  [chave(K.onboarding, 87710139)]: { origem: "agendar reunião onboarding", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 0 },
  [chave(K.onboarding, 87710143)]: { origem: "reunião ob. realizada", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 0 },
  [chave(K.onboarding, 87095291)]: { origem: "docs completos recebidos", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 0 },
  [chave(K.onboarding, 87094955)]: { origem: "criar tarefa advbox", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 0 },
  [chave(K.onboarding, 87095295)]: { origem: "pendência", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 0 },
  [chave(K.onboarding, 87094703)]: { origem: "Etapa de leads de entrada", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 0 },
  [chave(K.onboarding, GANHO_NA_KOMMO)]: { origem: "Ganho", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 0 },
  // O único descarte do Onboarding vai para o Perdido do COMERCIAL.
  [chave(K.onboarding, PERDIDO_NA_KOMMO)]: { origem: "descarte", funil: "Bancário - Comercial", etapa: "Perdido", leads: 1 },

  // ---------- Jurídico (Atendimento Geral) → Bancário - Jurídico ----------
  [chave(K.juridico, 87720715)]: { origem: "contato avulso", funil: "Bancário - Jurídico", etapa: "Contato Avulso", leads: 31 },
  [chave(K.juridico, 87720719)]: { origem: "Contato banco", funil: "Bancário - Jurídico", etapa: "Contato Banco", leads: 67 },
  [chave(K.juridico, 87255383)]: { origem: "cliente ativo", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 234 },
  [chave(K.juridico, 87255391)]: { origem: "cliente rescindido", funil: "Bancário - Jurídico", etapa: "Cliente Inativo", leads: 10 },
  [chave(K.juridico, 87255387)]: { origem: "Cliente encerrado", funil: "Bancário - Jurídico", etapa: "Cliente Inativo", leads: 0 },
  [chave(K.juridico, 87255379)]: { origem: "Etapa de leads de entrada", funil: "Bancário - Jurídico", etapa: "Contato Avulso", leads: 0 },
  [chave(K.juridico, GANHO_NA_KOMMO)]: { origem: "Venda ganha", funil: "Bancário - Jurídico", etapa: "Cliente Ativo", leads: 0 },
  [chave(K.juridico, PERDIDO_NA_KOMMO)]: { origem: "Venda perdida", funil: "Bancário - Comercial", etapa: "Perdido", leads: 0 },
};

/**
 * O funil "Checkpoints (Pós Vendas)" é DESCARTADO inteiro (decisão do
 * operador): são 2 leads, os dois de teste ("Teste", "Teste manter"), e não há
 * etapa de destino para pós-venda por marco.
 *
 * ⚠️ Descartado NÃO é "esquecido": é o que faz a conta fechar em
 * 12.714 + 2 = 12.716, e a carga tem de dizer isso no relatório.
 */
export const FUNIL_DESCARTADO = K.checkpoints;

/**
 * A etiqueta que MUDA o destino: lead com "CONTATO SEG. TRAB" vai para
 * Trabalhista - Jurídico › Contato de Emergência, seja qual for a etapa —
 * **menos** quem está em descarte, que continua no Perdido do Comercial.
 *
 * Medido: 242 leads com a etiqueta; 234 deles são contratos já protocolados,
 * e 2 estão em descarte. Por isso a exceção não é zelo: sem ela, dois leads
 * perdidos apareceriam como atendimento de emergência.
 */
export const ETIQUETA_DE_EMERGENCIA = "CONTATO SEG. TRAB";

export const DESTINO_DA_EMERGENCIA: DestinoDoLead = {
  funil: "Trabalhista - Jurídico",
  etapa: "Contato de Emergência",
};

export class DeParaDesconhecido extends Error {
  constructor(
    readonly pipelineId: number,
    readonly statusId: number,
  ) {
    super(
      `Etapa da Kommo sem de-para: pipeline ${pipelineId}, status ${statusId}. ` +
        `A carga aborta em vez de adivinhar — acrescente a linha em src/lib/migracao/de-para.ts.`,
    );
    this.name = "DeParaDesconhecido";
  }
}

/**
 * Onde este lead pousa. `null` quando o funil inteiro é descartado.
 *
 * ⚠️ LANÇA no par desconhecido, de propósito: etapa nova criada na Kommo entre
 * o levantamento e o corte entraria numa etapa qualquer e ninguém perceberia.
 */
export function destinoDoLead(args: {
  pipelineId: number;
  statusId: number;
  etiquetas?: readonly string[];
}): DestinoDoLead | null {
  if (args.pipelineId === FUNIL_DESCARTADO) return null;

  const linha = DE_PARA[chave(args.pipelineId, args.statusId)];
  if (!linha) throw new DeParaDesconhecido(args.pipelineId, args.statusId);

  const temEmergencia = (args.etiquetas ?? []).some(
    (t) => normalizarEtiqueta(t) === normalizarEtiqueta(ETIQUETA_DE_EMERGENCIA),
  );
  // O descarte vence a etiqueta: lead perdido não é atendimento de emergência.
  if (temEmergencia && args.statusId !== PERDIDO_NA_KOMMO) {
    return DESTINO_DA_EMERGENCIA;
  }

  return { funil: linha.funil, etapa: linha.etapa };
}

/** Aparada, sem acento, em minúsculas — a régua de `chaveDeTag`. */
export function normalizarEtiqueta(nome: string): string {
  return nome
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** A ÁREA do lead, que é o que reparte "um card por pessoa e por área". */
export function areaDoDestino(destino: DestinoDoLead): "trabalhista" | "bancario" {
  return destino.funil.startsWith("Trabalhista") ? "trabalhista" : "bancario";
}
