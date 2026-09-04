import {
  createSubscriber,
  getSubscribers,
  updateSubscriber,
  type ListmonkError,
} from './client';
import type { ListmonkSubscriber } from './types';

// ============================================================
// Contact → subscriber sync.
//
// wacrm's unit of identity is a PHONE NUMBER; listmonk's is an
// EMAIL ADDRESS. That asymmetry drives every decision here:
//
//   - A contact with no email cannot become a subscriber. It is
//     skipped and reported, never silently dropped — an operator
//     who "synced 500 contacts" and got 120 subscribers deserves
//     to know why.
//   - The wacrm contact id and phone ride along in listmonk's
//     free-form `attribs` JSON. That is the join key back to the
//     CRM, and it is what makes segmentation like "everyone who
//     came in over WhatsApp" expressible as a listmonk query.
// ============================================================

/** Shape we need off a wacrm contact row. */
export interface SyncableContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string;
  company?: string | null;
}

export interface SubscriberPayload {
  email: string;
  name: string;
  status: 'enabled';
  lists: number[];
  attribs: Record<string, unknown>;
  preconfirm_subscriptions: true;
}

/**
 * Conservative email check. This is not RFC 5322 — it is a gate that
 * keeps obvious junk out of listmonk (which rejects it anyway, one
 * slow round trip later) and, critically, guarantees the value is
 * safe to interpolate into the SQL-ish `query` parameter that
 * findSubscriberByEmail uses. Anything with a quote, space, or
 * semicolon fails here.
 */
export function isSyncableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return /^[^\s@'";\\]+@[^\s@'";\\]+\.[^\s@'";\\]{2,}$/.test(trimmed);
}

/**
 * Build the listmonk subscriber payload for a wacrm contact.
 *
 * Pure — no I/O — so the mapping is unit-testable without a running
 * listmonk.
 */
export function toSubscriberPayload(
  contact: SyncableContact,
  accountId: string,
  listIds: number[]
): SubscriberPayload {
  const email = (contact.email ?? '').trim().toLowerCase();

  return {
    email,
    // listmonk requires a non-empty name. Falling back to the phone
    // (rather than the email local-part) keeps the WhatsApp identity
    // visible in the listmonk UI, which is the whole point of the
    // integration.
    name: contact.name?.trim() || contact.phone,
    status: 'enabled',
    lists: listIds,
    attribs: {
      source: 'wacrm',
      wacrm_contact_id: contact.id,
      wacrm_account_id: accountId,
      phone: contact.phone,
      ...(contact.company ? { company: contact.company } : {}),
      synced_at: new Date().toISOString(),
    },
    // These contacts already messaged us on WhatsApp, so the operator
    // has a prior relationship. Double opt-in confirmation is still
    // enforced by the LIST's own optin setting — this flag only says
    // "don't hold this subscription in `unconfirmed` limbo".
    preconfirm_subscriptions: true,
  };
}

/**
 * Look a subscriber up by exact email.
 *
 * listmonk's `query` parameter is a raw SQL boolean expression
 * spliced into a WHERE clause, so the value MUST be validated before
 * it gets here — isSyncableEmail is that gate, and callers are
 * required to run it first. We additionally lowercase and reject any
 * residual quote as defence in depth.
 */
export async function findSubscriberByEmail(
  email: string
): Promise<ListmonkSubscriber | null> {
  const normalized = email.trim().toLowerCase();
  if (!isSyncableEmail(normalized)) {
    throw new Error(`Refusing to query listmonk with unsafe email: ${email}`);
  }

  const page = await getSubscribers({
    per_page: 1,
    query: `subscribers.email = '${normalized}'`,
  });
  return page.results[0] ?? null;
}

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** Human-readable reasons, capped so a bad import can't flood the UI. */
  errors: string[];
}

const MAX_REPORTED_ERRORS = 20;

/**
 * Merge listmonk's existing list memberships with the ones we're
 * adding, so syncing a contact into "WACRM Contacts" never silently
 * unsubscribes them from a newsletter they joined elsewhere.
 *
 * listmonk's PUT replaces the list set wholesale, which makes this
 * merge load-bearing rather than cosmetic.
 */
export function mergeListIds(
  existing: ListmonkSubscriber | null,
  incoming: number[]
): number[] {
  const current = (existing?.lists ?? [])
    // A subscriber who explicitly unsubscribed must not be silently
    // re-added to that list by a CRM sync.
    .filter((l) => l.subscription_status !== 'unsubscribed')
    .map((l) => l.id);
  return Array.from(new Set([...current, ...incoming]));
}

/**
 * Upsert one contact. Exported for the single-contact path (a "Add to
 * mailing list" action on a contact) as well as the bulk sync.
 */
export async function syncContact(
  contact: SyncableContact,
  accountId: string,
  listIds: number[]
): Promise<'created' | 'updated' | 'skipped'> {
  if (!isSyncableEmail(contact.email)) return 'skipped';

  const payload = toSubscriberPayload(contact, accountId, listIds);
  const existing = await findSubscriberByEmail(payload.email);

  if (existing) {
    await updateSubscriber(existing.id, {
      ...payload,
      // Preserve attributes set outside wacrm (a tag added by hand in
      // listmonk, say) rather than clobbering the whole object.
      attribs: { ...existing.attribs, ...payload.attribs },
      lists: mergeListIds(existing, listIds),
    });
    return 'updated';
  }

  await createSubscriber(payload);
  return 'created';
}

/**
 * Bulk sync with bounded concurrency.
 *
 * Each contact costs a lookup plus a write, so this is deliberately
 * not a fan-out over thousands of rows: five at a time keeps listmonk
 * and its Postgres responsive while still being ~5x a serial loop.
 * For very large one-off imports, listmonk's own
 * POST /api/import/subscribers (CSV) is the right tool.
 */
export async function syncContacts(
  contacts: SyncableContact[],
  accountId: string,
  listIds: number[],
  concurrency = 5
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const queue = [...contacts];

  async function worker() {
    for (;;) {
      const contact = queue.shift();
      if (!contact) return;
      try {
        const outcome = await syncContact(contact, accountId, listIds);
        result[outcome] += 1;
      } catch (err) {
        result.failed += 1;
        if (result.errors.length < MAX_REPORTED_ERRORS) {
          const message =
            (err as ListmonkError)?.message ??
            (err instanceof Error ? err.message : String(err));
          result.errors.push(`${contact.email ?? contact.phone}: ${message}`);
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, contacts.length) }, worker)
  );

  return result;
}

/**
 * The tag every wacrm-managed list carries, so the Email section can
 * tell "lists this CRM created" from lists an operator made directly
 * in listmonk.
 *
 * NOTE on multi-tenancy: listmonk is single-tenant. One listmonk
 * instance is intended to back ONE wacrm account. This tag gives soft
 * separation (and makes the intent legible) but is NOT a security
 * boundary — do not point two customers' accounts at one listmonk.
 */
export function accountListTag(accountId: string): string {
  return `wacrm:${accountId}`;
}
