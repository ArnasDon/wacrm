import type { Deal, Contact, Tag } from "@/types";

/**
 * Deal select that embeds the contact plus its tags, so deal cards can
 * render tag pills without a second round-trip per card. Mirrors
 * `CONVERSATION_SELECT` in `src/lib/inbox/conversations.ts` — same
 * `contact_tags(tags(*))` join, same flattening story.
 */
export const DEAL_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*))), assignee:profiles!deals_assigned_to_fkey(*)";

/** Raw shape returned by {@link DEAL_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawDeal = Omit<Deal, "contact"> & { contact?: RawContact | null };

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link DEAL_SELECT}; a deal with no
 * linked contact (deleted contact, `ON DELETE SET NULL`) passes through
 * untouched.
 */
export function normalizeDeal(raw: RawDeal): Deal {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Deal;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeDeals(rows: RawDeal[]): Deal[] {
  return rows.map(normalizeDeal);
}
