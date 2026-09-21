import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*))), group:cb_groups(*)";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
export type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Achata o join `contact_tags(tags(*))` numa lista de tags, descartando o
 * join órfão (`tags: null`). Compartilhado com o select do quadro de funis
 * (`src/lib/pipelines/cartao.ts`) — duas cópias desta regra já divergiram na
 * tipagem uma vez.
 */
export function achatarTags(
  contact_tags: { tags: Tag | null }[] | null | undefined,
): Tag[] {
  return (contact_tags ?? [])
    .map((ct) => ct.tags)
    .filter((t): t is Tag => t != null);
}

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: achatarTags(contact_tags),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

/**
 * Como combinar as etiquetas escolhidas.
 *
 * ⚠️ `qualquer` é o comportamento do upstream (OR) e continua sendo o padrão —
 * por isso `tagMode` é opcional. `todas` (AND) é nosso, e a diferença é a
 * pergunta que o operador faz: "quem é VIP OU inadimplente" contra "quem é
 * VIP E inadimplente ao mesmo tempo".
 */
export type ModoDeEtiqueta = "qualquer" | "todas";

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** `qualquer` (OR, padrão) ou `todas` (AND). */
  tagMode?: ModoDeEtiqueta;
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags default to OR logic, consistent with Broadcast
 * audiences; `tagMode: 'todas'` switches to AND.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, tagMode = "qualquer", company }: ContactFilters,
): boolean {
  // Conversa de GRUPO não tem contato, então nunca casa com filtro de
  // etiqueta ou empresa — e isso está certo: o filtro pergunta algo sobre uma
  // PESSOA, e um grupo não é uma. Sair do resultado é a resposta honesta.
  if (tagIds.length > 0) {
    const doContato = new Set(
      (conversation.contact?.tags ?? []).map((t) => t.id),
    );
    const casou =
      tagMode === "todas"
        ? tagIds.every((id) => doContato.has(id))
        : tagIds.some((id) => doContato.has(id));
    if (!casou) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}

/** O que a lista do inbox está mostrando. */
export type TipoDeConversa = "todas" | "diretas" | "grupos";

/**
 * Recorte por tipo. Fica separado dos filtros de contato porque é ortogonal a
 * eles: "só grupos" + "etiqueta VIP" não faz sentido nenhum (grupo não tem
 * etiqueta), e misturar os dois num filtro só esconderia isso do operador.
 */
export function matchesTypeFilter(
  conversation: Conversation,
  tipo: TipoDeConversa,
): boolean {
  if (tipo === "todas") return true;
  const ehGrupo = !!conversation.group_id;
  return tipo === "grupos" ? ehGrupo : !ehGrupo;
}
