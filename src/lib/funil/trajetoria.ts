import {
  type Classificacao,
  type ClasseDaEtapa,
  DEGRAUS,
  indiceDoDegrau,
} from "./degraus";

/**
 * A TRAJETÓRIA de um negócio: as etapas em que ele entrou, quando, e por
 * quem — uma linha da RPC `cb_funil_trajetorias` (migration 975), lida SEM
 * `as` (a forma vem do banco e pode mudar; um cast entregaria `undefined`
 * ao cálculo). Deste módulo saem os FATOS que a lista e o painel usam:
 * entrada no funil, degrau máximo alcançado, situação, "na etapa desde".
 *
 * As regras são as da seção 3.2 do plano (docs/PLANO-funil-comercial.md):
 *
 *  1. Entrada no funil = primeira entrada numa etapa COM classe (degrau ou
 *     perda). Negócio nascido em etapa sem degrau e movido depois entra no
 *     movimento; entrar direto em perda É entrada (alguém avaliou e descartou).
 *  3. Alcançou o degrau k = entrou em alguma etapa de degrau ≥ k. Monotônico
 *     por construção: quem pulou de Lead para Proposta conta como tendo
 *     passado por MQL e Reunião — nenhuma taxa passa de 100%.
 *  4. Situação = a classe da etapa em que está HOJE.
 *  5. Na etapa desde = a última entrada na etapa atual (ou a criação).
 *  6. ⚠️⚠️ NEGÓCIO TRANSFERIDO PARA OUTRO FUNIL CONTINUA CONTANDO NO FUNIL DE
 *     ORIGEM, com a última etapa que teve aqui. DECISÃO DO OPERADOR
 *     (2026-09-03), que pediu que ficasse escrita: o fluxo é "fechou →
 *     transfere para o funil do Jurídico → continua ganho". Sem isto, cada
 *     contrato fechado sumiria da estatística comercial ao ser transferido.
 *     A RPC devolve o negócio porque ele tem evento com `to_pipeline_id` =
 *     este funil; aqui, `noFunil = false` e `transferidoPara` diz para onde.
 *  7. (18/09/2026) Cada degrau tem uma DATA: a primeira vez em que o negócio
 *     entrou numa etapa de degrau ≥ k (`alcancouEm`). É o que a contagem
 *     "por período" usa (`por-periodo.ts`): os 5 contratos fechados este mês
 *     aparecem neste mês, mesmo que os leads tenham entrado no mês passado.
 *
 * ⚠️ O mapeamento é lido HOJE, sobre a história inteira — remapear uma etapa
 * reescreve o passado de propósito (o operador configura depois e vê o
 * funil). O preço: etapa APAGADA some da classificação, e os passos dela
 * viram "sem classe" — a entrada no funil desliza para a próxima etapa
 * mapeada, e negócio que só passou por ela sai da coorte. Por isso a tela de
 * Funis BARRA apagar etapa mapeada que tenha histórico na trilha
 * (`handleRemoveStage`); quem tirar essa guarda precisa de outra resposta
 * para a história (achado do Codex no PR #119).
 */

export interface PassoDoTrajeto {
  /** etapa em que entrou (`to_stage_id`); nula só em evento malformado. */
  etapa: string | null;
  /** funil daquela etapa (`to_pipeline_id`). */
  funil: string | null;
  /** instante (ISO 8601). */
  em: string;
  origem: string | null;
  /** `deal_created` | `stage_changed` | `pipeline_changed`. */
  tipo: string | null;
}

export interface LinhaDeTrajetoria {
  deal_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  /** a conversa do CONTATO (UNIQUE por conta, 036) — a que o card abre. */
  conversa_do_contato: string | null;
  title: string;
  value: number;
  status: string | null;
  /** funil ATUAL do negócio — pode ser outro, se foi transferido. */
  pipeline_id: string;
  stage_id: string;
  channel_id: string | null;
  source: string | null;
  assigned_to: string | null;
  /**
   * ⚠️ NULO é possível: `deals.created_at` é `DEFAULT now()` mas NULLABLE
   * (001, e a 912 já usa `coalesce` reconhecendo isso). Exigi-lo aqui fazia
   * UMA linha assim derrubar `carregarTrajetorias` inteiro — que devolve
   * `null` no primeiro registro inválido — e as três vistas do funil
   * ficavam em "falhou · tentar de novo" PARA SEMPRE, por causa de um
   * carimbo de data que só serve de queda para `naEtapaDesde` e de coluna
   * na lista (revisão do PR #123). A régua "não confie" vale para desvio de
   * FORMA, não para um timestamp opcional.
   */
  created_at: string | null;
  updated_at: string | null;
  contato_nome: string | null;
  contato_telefone: string | null;
  contato_email: string | null;
  contato_empresa: string | null;
  contato_avatar: string | null;
  /** `field_key` → valor, só os preenchidos. */
  campos: Record<string, string>;
  /** em ordem cronológica, inclusive a saída para outro funil. */
  trajeto: PassoDoTrajeto[];
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** string → ela; null/undefined → null; qualquer outra coisa → inválido. */
function textoOuNulo(v: unknown): string | null | undefined {
  if (v == null) return null;
  return typeof v === "string" ? v : undefined;
}

/** `numeric` chega como número OU como texto, conforme o caminho. */
function lerNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (v == null) return 0;
  return null;
}

function lerCampos(v: unknown): Record<string, string> | undefined {
  if (v == null) return {};
  if (!ehObjeto(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(v)) {
    if (typeof valor === "string") out[chave] = valor;
  }
  return out;
}

function lerPasso(v: unknown): PassoDoTrajeto | null {
  if (!ehObjeto(v)) return null;
  if (typeof v.em !== "string") return null;
  const etapa = textoOuNulo(v.etapa);
  const funil = textoOuNulo(v.funil);
  const origem = textoOuNulo(v.origem);
  const tipo = textoOuNulo(v.tipo);
  if (etapa === undefined || funil === undefined || origem === undefined || tipo === undefined) {
    return null;
  }
  return { etapa, funil, em: v.em, origem, tipo };
}

function lerTrajeto(v: unknown): PassoDoTrajeto[] | undefined {
  if (v == null) return [];
  if (!Array.isArray(v)) return undefined;
  const passos: PassoDoTrajeto[] = [];
  for (const item of v) {
    const passo = lerPasso(item);
    if (!passo) return undefined;
    passos.push(passo);
  }
  return passos;
}

/** Parse de uma linha da RPC. `null` = linha inválida ("não confie"). */
export function lerLinha(cru: unknown): LinhaDeTrajetoria | null {
  if (!ehObjeto(cru)) return null;
  const { deal_id, pipeline_id, stage_id, created_at } = cru;
  if (typeof deal_id !== "string" || typeof pipeline_id !== "string" || typeof stage_id !== "string") {
    return null;
  }
  const value = lerNumero(cru.value);
  if (value === null) return null;
  const trajeto = lerTrajeto(cru.trajeto);
  if (!trajeto) return null;
  const campos = lerCampos(cru.campos);
  if (!campos) return null;

  const opcionais = {
    contact_id: textoOuNulo(cru.contact_id),
    conversation_id: textoOuNulo(cru.conversation_id),
    conversa_do_contato: textoOuNulo(cru.conversa_do_contato),
    status: textoOuNulo(cru.status),
    channel_id: textoOuNulo(cru.channel_id),
    source: textoOuNulo(cru.source),
    assigned_to: textoOuNulo(cru.assigned_to),
    updated_at: textoOuNulo(cru.updated_at),
    contato_nome: textoOuNulo(cru.contato_nome),
    contato_telefone: textoOuNulo(cru.contato_telefone),
    contato_email: textoOuNulo(cru.contato_email),
    contato_empresa: textoOuNulo(cru.contato_empresa),
    contato_avatar: textoOuNulo(cru.contato_avatar),
  };
  for (const valor of Object.values(opcionais)) {
    if (valor === undefined) return null;
  }

  return {
    deal_id,
    pipeline_id,
    stage_id,
    created_at: typeof created_at === "string" ? created_at : null,
    title: typeof cru.title === "string" ? cru.title : "",
    value,
    trajeto,
    campos,
    contact_id: opcionais.contact_id ?? null,
    conversation_id: opcionais.conversation_id ?? null,
    conversa_do_contato: opcionais.conversa_do_contato ?? null,
    status: opcionais.status ?? null,
    channel_id: opcionais.channel_id ?? null,
    source: opcionais.source ?? null,
    assigned_to: opcionais.assigned_to ?? null,
    updated_at: opcionais.updated_at ?? null,
    contato_nome: opcionais.contato_nome ?? null,
    contato_telefone: opcionais.contato_telefone ?? null,
    contato_email: opcionais.contato_email ?? null,
    contato_empresa: opcionais.contato_empresa ?? null,
    contato_avatar: opcionais.contato_avatar ?? null,
  };
}

export type Situacao =
  /** a etapa atual não tem degrau: ainda não entrou (ou saiu) do funil de eficiência */
  | "fora_do_funil"
  /** está em lead e nunca passou dele — o "não respondeu" da referência */
  | "sem_avanco"
  /** em mql/reuniao/proposta (ou de volta em lead depois de ter avançado) */
  | "andamento"
  /** está numa etapa de contrato */
  | "fechado"
  /** está numa etapa de perda */
  | "perdido";

export interface FatosDoNegocio {
  linha: LinhaDeTrajetoria;
  /** o negócio está NESTE funil hoje. */
  noFunil: boolean;
  /** funil atual, quando saiu deste (regra 6). */
  transferidoPara: string | null;
  /** regra 1; nulo = nunca entrou numa etapa com classe. */
  entradaEm: Date | null;
  /** índice em DEGRAUS (regra 3); nulo = nunca entrou num degrau positivo. */
  degrauMaximo: number | null;
  /**
   * Regra 7 (contagem POR PERÍODO, 18/09/2026): o instante em que o negócio
   * alcançou cada degrau PELA PRIMEIRA VEZ — a primeira entrada numa etapa
   * de degrau ≥ k. Um item por posição de `DEGRAUS`; nulo = nunca alcançou.
   *
   * ⚠️ É a versão DATADA da regra 3, e herda as duas garantias que o
   * operador pediu por escrito: (1) cada negócio tem UMA data por degrau,
   * então entrar duas vezes em "Reunião Agendada" — no mesmo mês ou em
   * outro — conta uma vez só, na primeira; (2) quem pula de Reunião para
   * Contrato alcança Proposta NA DATA DO CONTRATO. Monotônica por
   * construção: `alcancouEm[k] <= alcancouEm[k+1]` sempre que os dois
   * existem.
   */
  alcancouEm: (Date | null)[];
  /** etapa atual NESTE funil (a última que teve aqui, se transferido). */
  etapaAtual: string | null;
  classeAtual: ClasseDaEtapa | null;
  /** regra 5. */
  /** nulo só quando não há passo AQUI nem `created_at` — ver o tipo da linha. */
  naEtapaDesde: Date | null;
  situacao: Situacao;
  /** chegou ao último degrau (conta como contrato mesmo se voltou depois). */
  alcancouContrato: boolean;
}

function instante(iso: string): number {
  return new Date(iso).getTime();
}

function situacaoDe(classeAtual: ClasseDaEtapa | null, degrauMaximo: number | null): Situacao {
  if (classeAtual === null) return "fora_do_funil";
  if (classeAtual === "perda") return "perdido";
  if (classeAtual === "contrato") return "fechado";
  if (classeAtual === "lead" && (degrauMaximo ?? 0) === 0) return "sem_avanco";
  return "andamento";
}

export function fatosDoNegocio(
  linha: LinhaDeTrajetoria,
  pipelineId: string,
  classificacao: Classificacao,
): FatosDoNegocio {
  const passos = [...linha.trajeto].sort((a, b) => instante(a.em) - instante(b.em));
  const aqui = passos.filter((p) => p.funil === pipelineId);

  let entradaEm: Date | null = null;
  let degrauMaximo: number | null = null;
  const alcancouEm: (Date | null)[] = DEGRAUS.map(() => null);
  for (const passo of aqui) {
    const classe = passo.etapa ? classificacao.classeDaEtapa.get(passo.etapa) : undefined;
    if (!classe) continue;
    if (!entradaEm) entradaEm = new Date(passo.em);
    if (classe !== "perda") {
      const indice = indiceDoDegrau(classe);
      if (degrauMaximo === null || indice > degrauMaximo) degrauMaximo = indice;
      // Os passos estão em ordem cronológica: a primeira vez que um degrau
      // ≥ k aparece é a data do degrau k — e de todo degrau abaixo dele que
      // ainda não tinha data (o pulo de etapa).
      for (let k = 0; k <= indice; k++) {
        if (alcancouEm[k] === null) alcancouEm[k] = new Date(passo.em);
      }
    }
  }

  const noFunil = linha.pipeline_id === pipelineId;
  const ultimoAqui = aqui.length > 0 ? aqui[aqui.length - 1] : null;
  const etapaAtual = noFunil ? linha.stage_id : (ultimoAqui?.etapa ?? null);
  const classeAtual = etapaAtual ? (classificacao.classeDaEtapa.get(etapaAtual) ?? null) : null;

  let naEtapaDesde: Date | null = null;
  for (let i = aqui.length - 1; i >= 0; i--) {
    if (aqui[i].etapa === etapaAtual) {
      naEtapaDesde = new Date(aqui[i].em);
      break;
    }
  }

  return {
    linha,
    noFunil,
    transferidoPara: noFunil ? null : linha.pipeline_id,
    entradaEm,
    degrauMaximo,
    alcancouEm,
    etapaAtual,
    classeAtual,
    naEtapaDesde: naEtapaDesde ?? (linha.created_at ? new Date(linha.created_at) : null),
    situacao: situacaoDe(classeAtual, degrauMaximo),
    alcancouContrato: degrauMaximo === indiceDoDegrau("contrato"),
  };
}

/**
 * Estado OTIMISTA depois de mover o negócio na tela: carimba a etapa e
 * acrescenta o passo ao trajeto, no mesmo formato que o gatilho da 912 vai
 * gravar. Quem chama re-deriva os fatos com `fatosDoNegocio`.
 */
export function aplicarMudancaDeEtapa(
  linha: LinhaDeTrajetoria,
  stageId: string,
  em: Date,
): LinhaDeTrajetoria {
  return {
    ...linha,
    stage_id: stageId,
    updated_at: em.toISOString(),
    trajeto: [
      ...linha.trajeto,
      {
        etapa: stageId,
        funil: linha.pipeline_id,
        em: em.toISOString(),
        origem: "usuario",
        tipo: "stage_changed",
      },
    ],
  };
}
