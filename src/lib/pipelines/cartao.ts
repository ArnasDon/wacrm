// ============================================================
// O que o quadro de funis sabe sobre a CONVERSA de cada card.
//
// ⚠️ POR QUE UM SELECT PRÓPRIO, E NÃO O `CONVERSATION_SELECT` DO INBOX
// Aquele select é contrato da API pública v1 (ver o comentário em
// `conversation-list.tsx`) — estendê-lo mudaria a resposta de `/api/v1`.
// Este aqui é só do quadro: embute, via contato, a conversa (não lidas +
// última mensagem) e as etiquetas.
//
// ⚠️ SEM REALTIME, DE PROPÓSITO. `deals` e `contact_tags` não estão na
// publication, e o gesto que importa — voltar do inbox para o funil —
// REMONTA a página e refaz o fetch: o dado se corrige exatamente quando o
// operador volta a olhar para ele. Uma assinatura aqui seria infra nova
// para encurtar uma janela que o próprio fluxo já fecha.
// ============================================================

import type { Contact, Deal, Tag } from "@/types";
import { achatarTags } from "@/lib/inbox/conversations";

/** As quatro colunas da conversa que o card exibe. */
export interface ResumoDaConversa {
  id: string;
  unread_count: number;
  last_message_text: string | null;
  last_message_at: string | null;
}

/**
 * `conversations` sem alias: o PostgREST resolve o embed reverso pela FK
 * `conversations.contact_id`. A UNIQUE da 036 (`account_id, contact_id`)
 * garante no máximo uma linha por contato — mas o índice é COMPOSTO, então
 * não dá para prever se a resposta vem como array ou objeto;
 * {@link normalizarDealDoQuadro} aceita os dois.
 */
export const DEAL_SELECT_DO_QUADRO =
  "*, contact:contacts(*, contact_tags(tags(*)), conversations(id, unread_count, last_message_text, last_message_at)), assignee:profiles!deals_assigned_to_fkey(*)";

/** O select de antes do embed novo — é o plano B quando o PostgREST recusa. */
export const DEAL_SELECT_BASICO =
  "*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)";

/** Forma crua devolvida por {@link DEAL_SELECT_DO_QUADRO}, antes do achatamento. */
type RawContactDoQuadro = Contact & {
  contact_tags?: { tags: Tag | null }[] | null;
  conversations?: ResumoDaConversa[] | ResumoDaConversa | null;
};
export type RawDealDoQuadro = Omit<Deal, "contact"> & {
  contact?: RawContactDoQuadro | null;
};

export type DealDoQuadro = Deal & {
  /** A conversa do CONTATO do card (única pela 036), ou null. */
  conversa: ResumoDaConversa | null;
};

/**
 * O quadro carrega em DUAS etapas (22/09/2026). Medido no "Trabalhista -
 * Comercial", com 3.673 cards: o select acima para TODOS eram 6,6 MB e
 * ~2,7 s de rede, e cortar colunas dele quase não ajudava (2,1 s) — o custo
 * é montar os embutidos das 3.673 linhas. Então a página busca:
 *   1. esta lista ENXUTA de todos os cards (~230 bytes cada, ~0,8 s): coluna,
 *      contador, soma, indicadores e arrasto, o que precisa da coluna INTEIRA;
 *   2. o conteúdo completo só dos cards que as colunas DESENHAM (os 100
 *      primeiros de cada uma, ~0,3 s), por id e só deste funil.
 * Quem acrescentar coluna aqui paga em todos os cards do funil.
 */
export const DEAL_SELECT_ENXUTO =
  "id, stage_id, title, value, status, created_at, updated_at";

/** Um card da lista enxuta cujo conteúdo ainda não chegou. */
export type CardSemConteudo = Pick<
  Deal,
  "id" | "stage_id" | "title" | "value" | "status" | "created_at" | "updated_at"
>;

/** O que o quadro guarda de cada card: completo, ou ainda só a linha enxuta. */
export type CardDoQuadro = DealDoQuadro | CardSemConteudo;

/**
 * ⚠️ O card completo é o que tem `conversa`: `normalizarDealDoQuadro` a
 * preenche SEMPRE (null quando não há conversa), inclusive no plano B, e a
 * lista enxuta nunca a traz. Quem mudar um dos dois lados muda esta regra.
 */
export function temConteudo(card: CardDoQuadro): card is DealDoQuadro {
  return "conversa" in card;
}

/**
 * O conteúdo que chegou, aplicado ao quadro: preenche os cards PEDIDOS que
 * ainda não o tinham, e tira do quadro o pedido que não voltou — o negócio
 * foi apagado, ou saiu do funil, entre a lista e o conteúdo (que é buscado
 * só no funil aberto), e ficaria "carregando" para sempre. Card que já tem
 * conteúdo não é tocado. Devolve a MESMA lista quando nada muda.
 *
 * ⚠️ Os campos da linha enxuta VENCEM os do conteúdo (ela é espalhada por
 * último). As duas consultas saem em momentos diferentes, e é a enxuta que
 * decide a coluna — e ela pode ter sido mexida aqui depois, por um arrasto.
 * Deixar o conteúdo vencer punha a etapa de uma consulta no card e a de outra
 * na coluna, e o formulário, aberto pelo lápis, regravaria a etapa velha ao
 * salvar outro campo (Codex, PR #248).
 */
export function juntarConteudo(
  cards: CardDoQuadro[],
  pedidos: readonly string[],
  conteudo: ReadonlyMap<string, DealDoQuadro>,
): CardDoQuadro[] {
  const pedido = new Set(pedidos);
  let mudou = false;
  const saida: CardDoQuadro[] = [];
  for (const card of cards) {
    if (temConteudo(card) || !pedido.has(card.id)) {
      saida.push(card);
      continue;
    }
    mudou = true;
    const chegou = conteudo.get(card.id);
    if (chegou) saida.push({ ...chegou, ...card });
  }
  return mudou ? saida : cards;
}

/**
 * A marca que um arrasto deixa no card: o passo em que foi feita (um contador
 * que só sobe) e se o banco já CONFIRMOU a gravação.
 */
export interface MarcaDeArrasto {
  passo: number;
  confirmado: boolean;
}

/**
 * Quais cards a leitura que partiu no passo `inicio` precisa manter como
 * estão na tela, e quais marcas ela aposenta.
 *
 * - Arrasto ainda NÃO confirmado: sempre mantido. A leitura pode ter partido
 *   depois do gesto e lido o card antes de a gravação chegar ao banco.
 * - Confirmado DEPOIS de a leitura partir: mantido, pelo mesmo motivo.
 * - Confirmado ANTES: a leitura já traz a etapa nova, e a marca sai.
 */
export function movidosParaALeitura(
  marcas: ReadonlyMap<string, MarcaDeArrasto>,
  inicio: number,
): { manter: Set<string>; aposentar: string[] } {
  const manter = new Set<string>();
  const aposentar: string[] = [];
  for (const [id, marca] of marcas) {
    if (marca.confirmado && marca.passo <= inicio) aposentar.push(id);
    else manter.add(id);
  }
  return { manter, aposentar };
}

/**
 * A recarga que chega depois de um arrasto feito com ela no ar. A etapa e o
 * status dos cards `movidos` saem de `atual` (o que o arrasto pôs na tela, com
 * o status que o banco devolveu), e todo o resto sai da `resposta`. A resposta
 * pode ter lido o card antes de o arrasto gravar, e sem isto o card voltava à
 * coluna antiga — e o lápis, aberto sobre ele, regravava a etapa velha.
 *
 * Card movido que a resposta não traz fica de fora: ela é a verdade sobre o
 * que existe no funil (apagado, ou levado para outro).
 */
export function manterMovimentosLocais(
  resposta: CardDoQuadro[],
  atual: readonly CardDoQuadro[],
  movidos: ReadonlySet<string>,
): CardDoQuadro[] {
  if (movidos.size === 0) return resposta;
  const local = new Map<string, CardDoQuadro>();
  for (const card of atual) if (movidos.has(card.id)) local.set(card.id, card);
  return resposta.map((card) => {
    const aqui = local.get(card.id);
    return aqui ? { ...card, stage_id: aqui.stage_id, status: aqui.status } : card;
  });
}

/**
 * Entre as conversas embutidas, qual representa o card. Mais de uma linha só
 * acontece em sobra que a 036 não pegou — aí vale a que casa com o vínculo
 * gravado no negócio; sem casar, a de conversa mais recente.
 *
 * A comparação de `last_message_at` é lexicográfica: o PostgREST serializa
 * todos os timestamps da mesma resposta no mesmo formato ISO.
 */
function escolherConversa(
  lista: ResumoDaConversa[],
  conversationId: string | null,
): ResumoDaConversa | null {
  if (lista.length === 0) return null;
  if (conversationId) {
    const casada = lista.find((c) => c.id === conversationId);
    if (casada) return casada;
  }
  return lista.reduce((melhor, c) => {
    if (!melhor.last_message_at) return c.last_message_at ? c : melhor;
    if (!c.last_message_at) return melhor;
    return c.last_message_at > melhor.last_message_at ? c : melhor;
  });
}

/**
 * Achata o embed em `contact.tags` (via {@link achatarTags}, a mesma regra do
 * inbox) e resolve `conversa`. Linha sem contato passa limpa — negócio de
 * contato apagado continua no quadro.
 *
 * ⚠️ `tags` só é preenchido quando o embed VEIO na resposta: no plano B
 * (`DEAL_SELECT_BASICO`, sem `contact_tags`) o campo fica ausente, e o card
 * não exibe nada — fabricar `[]` faria a UI afirmar "sem etiquetas" sobre um
 * dado que ela não carregou.
 *
 * As etiquetas saem ordenadas por nome: o embed não tem ORDER BY, e sem uma
 * ordem estável o trio exibido (`slice(0, 3)`) trocaria de composição a cada
 * refetch, com o dado parado.
 */
export function normalizarDealDoQuadro(raw: RawDealDoQuadro): DealDoQuadro {
  const rawContact = raw.contact;
  if (!rawContact) return { ...(raw as Deal), contact: undefined, conversa: null };

  const { contact_tags, conversations, ...contact } = rawContact;
  const lista = Array.isArray(conversations)
    ? conversations
    : conversations
      ? [conversations]
      : [];

  return {
    ...(raw as Deal),
    contact: {
      ...contact,
      ...(contact_tags === undefined
        ? {}
        : {
            tags: achatarTags(contact_tags).sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          }),
    },
    conversa: escolherConversa(lista, raw.conversation_id ?? null),
  };
}

/**
 * A conversa que o card ABRE, e o resumo que ele exibe.
 *
 * ⚠️ A conversa do CONTATO manda; `deals.conversation_id` é só o fallback.
 * O card exibe a identidade do contato (nome, etiquetas), então o clique tem
 * de abrir a conversa DESSA pessoa: com a precedência invertida, trocar o
 * contato do negócio no formulário deixava o card mostrando o Bruno e o
 * clique abrindo a conversa da Ana (o vínculo histórico da 910, que o update
 * nunca reescreve — "`conversation_id` só no NASCIMENTO"). Achado da revisão
 * do PR #71. O fallback cobre os dois casos legítimos: contato apagado
 * (contact_id NULL, mas o vínculo gravado sobrevive) e o plano B do select,
 * que não embute `conversations`.
 */
export function conversaDoCard(
  deal: DealDoQuadro,
): { id: string; resumo: ResumoDaConversa | null } | null {
  if (deal.conversa) return { id: deal.conversa.id, resumo: deal.conversa };
  if (deal.conversation_id) return { id: deal.conversation_id, resumo: null };
  return null;
}
