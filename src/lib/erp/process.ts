// ============================================================
// Acting on an ERP event: find the contact, keep its details in
// step with the ERP, link it to the branch that served it, and send
// the approved WhatsApp template the event calls for.
//
// Runs as the service role (there is no logged-in human on an ERP
// webhook), so every query is explicitly scoped by `accountId` —
// the same discipline the public API and the WhatsApp webhook
// follow. Nothing here reads `auth.uid()`.
//
// Ordering within one event:
//
//   1. resolve the contact (by ERP id, then by phone, else create)
//   2. mirror the ERP's fields onto it
//   3. link it to the branch's store, if the event names one
//   4. send the template, if the event maps to one
//
// Steps 1-3 run even when step 4 is skipped. A customer who has
// opted out of marketing still belongs in the CRM, still belongs to
// their store, and their staff still need to see them in the inbox.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import {
  isValidE164,
  normalizePhone,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import {
  extractBranch,
  extractBranchReviewUrl,
  extractCustomer,
  isKnownEventType,
  isMarketingEvent,
  plainTemplateFor,
  requiresBranchPhone,
  templatePlanFor,
  type ErpCustomer,
  type ErpEvent,
  type TemplatePlan,
} from './events';
import {
  enqueueReviewRequest,
  resolveReviewUrl,
  reviewOrderKey,
  supersedeQueuedReview,
} from './review-queue';
import { shouldSendForBranch } from './send-gate';

/** The tag every ERP-sourced contact carries, so they are filterable. */
export const ERP_CONTACT_TAG = 'erp-customer';

/** Custom attributes mirrored from the ERP onto the contact. */
const CUSTOM_FIELDS = {
  totalSpent: 'total_spent',
  lastPurchase: 'last_purchase',
  birthDate: 'birth_date',
  referralDiscount: 'referral_discount_percent',
} as const;

export interface ErpProcessContext {
  db: SupabaseClient;
  accountId: string;
  /** Account currency for money variables in templates. */
  currency: string;
  /** Where `review_request`'s button points. Null disables that one event. */
  reviewUrl: string | null;
  /**
   * Days after delivery before the review request falls due. From
   * `message_settings` (migration 052), which the operator edits in
   * Settings -> Messages.
   */
  reviewDelayDays: number;
  /**
   * Branches whose events may actually send a WhatsApp message,
   * already normalised. Empty = no gate, every branch sends.
   * See lib/erp/send-gate.ts.
   */
  allowedBranches: string[];
}

export type ErpEventStatus = 'done' | 'skipped' | 'failed';

export interface ErpEventOutcome {
  status: ErpEventStatus;
  detail?: string;
  contactId?: string;
  /**
   * Meta's id for the message this event sent, when it sent one.
   *
   * Its PRESENCE is the only honest answer to "did a customer
   * actually receive something". `status: 'done'` does not mean that:
   * `ping` and `customer.upsert` both succeed having sent nothing,
   * and the ERP's report must not call those sent.
   */
  whatsappMessageId?: string;
  /**
   * OUR `messages.id` for that message — the ledger's join to what
   * Meta did with it afterwards. Not Meta's id: migration 009 records
   * that Meta's repeat across phone numbers, so they cannot be a key.
   */
  messageId?: string;
  /** The branch the ERP named, for the activity screen's filter. */
  branch?: string | null;
  /**
   * The bill number, else the ERP's order id — what a person types
   * into the search box, and what a customer is holding.
   */
  orderRef?: string | null;
}

/**
 * Prefix that marks a ledger detail as "the ERP named a branch no
 * CRM store answers to". `/api/erp/status` searches for this exact
 * string to list the branch names that are going unfiled, so it is a
 * wire format between the two files: change it in both or not at all.
 * The branch name follows the prefix verbatim.
 */
export const UNMATCHED_BRANCH = 'branch matched no store: ';

/** What `linkContactToBranch` did, and why, in words fit for the ledger. */
export type StoreLinkResult =
  | {
      linked: true;
      /** The store's id, used as the review button's URL suffix. */
      storeId: string;
      storeName: string;
      storeCode: string;
      /** The store's own contact number, or null if nobody set one. */
      storePhone: string | null;
      /**
       * This branch's own Google review link, or null to fall back to
       * the account-wide one. Google attaches reviews to a location,
       * so a branch's customers belong on that branch's listing.
       */
      storeReviewUrl: string | null;
    }
  | { linked: false; reason: string };

// ------------------------------------------------------------
// Account + config
// ------------------------------------------------------------

/**
 * Which account the ERP's events belong to.
 *
 * `ERP_ACCOUNT_ID` wins when set. Otherwise we resolve the single
 * account that has WhatsApp connected — a deployment serving exactly
 * one business (which this one is) should not need an extra env var
 * to state the obvious.
 *
 * Ambiguity is an error, never a guess: with two configured accounts
 * and no `ERP_ACCOUNT_ID`, picking one would silently file another
 * business's customers under the wrong tenant.
 */
export async function resolveErpAccountId(
  db: SupabaseClient,
  explicit: string | undefined,
): Promise<{ accountId: string } | { error: string }> {
  if (explicit && explicit.trim().length > 0) {
    const { data, error } = await db
      .from('accounts')
      .select('id')
      .eq('id', explicit.trim())
      .maybeSingle();
    if (error) return { error: 'Could not look up ERP_ACCOUNT_ID' };
    if (!data) return { error: 'ERP_ACCOUNT_ID does not match any account' };
    return { accountId: data.id as string };
  }

  const { data, error } = await db
    .from('whatsapp_config')
    .select('account_id')
    .limit(2);
  if (error) return { error: 'Could not resolve the ERP account' };
  if (!data || data.length === 0) {
    return { error: 'No account has WhatsApp configured yet' };
  }
  if (data.length > 1) {
    return {
      error:
        'More than one account has WhatsApp configured — set ERP_ACCOUNT_ID to say which one the ERP writes to',
    };
  }
  return { accountId: data[0].account_id as string };
}

// ------------------------------------------------------------
// Contacts
// ------------------------------------------------------------

interface ResolvedContact {
  id: string;
  phone: string;
  marketingOptOut: boolean;
}

/**
 * Find the CRM contact for an ERP customer, creating it if needed.
 *
 * Match order is `erpCustomerId` first, phone second — the ERP's id
 * is stable across a customer changing their number, while a phone
 * number can be reassigned by the telco to someone else entirely.
 * When an ERP id match is found we also take the opportunity to
 * update the stored phone, which is how a number change propagates.
 *
 * Returns null when there is nothing to match on and nothing valid
 * to create from (no usable phone) — the caller records that as a
 * skip, not a failure, per the handover: "If a customer has no valid
 * phone, skip and still return success for that event."
 */
export async function findOrCreateErpContact(
  ctx: ErpProcessContext,
  customer: ErpCustomer,
): Promise<ResolvedContact | null> {
  const { db, accountId } = ctx;
  const select = 'id, phone, marketing_opt_out';

  if (customer.erpCustomerId) {
    const { data } = await db
      .from('contacts')
      .select(select)
      .eq('account_id', accountId)
      .eq('erp_customer_id', customer.erpCustomerId)
      .maybeSingle();
    if (data) {
      return {
        id: data.id as string,
        phone: data.phone as string,
        marketingOptOut: Boolean(data.marketing_opt_out),
      };
    }
  }

  const phone = sanitizePhoneForMeta(customer.phone ?? '');
  if (!phone || !isValidE164(phone)) return null;

  const existing = await findExistingContact(db, accountId, phone);
  if (existing) {
    return {
      id: existing.id,
      phone: existing.phone,
      marketingOptOut: Boolean(
        (existing as Record<string, unknown>).marketing_opt_out,
      ),
    };
  }

  const auditUserId = await resolveAuditUserId(db, accountId);
  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      phone,
      name: customer.name || phone,
      email: customer.email ?? null,
      erp_customer_id: customer.erpCustomerId ?? null,
    })
    .select(select)
    .single();

  if (error || !created) {
    // Lost a race with an inbound WhatsApp message creating the same
    // contact. The unique index did its job; re-resolve the winner
    // rather than failing an event we can still handle.
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, phone);
      if (raced) {
        return {
          id: raced.id,
          phone: raced.phone,
          marketingOptOut: Boolean(
            (raced as Record<string, unknown>).marketing_opt_out,
          ),
        };
      }
    }
    throw new Error(`Failed to create contact: ${error?.message ?? 'unknown'}`);
  }

  return {
    id: created.id as string,
    phone: created.phone as string,
    marketingOptOut: Boolean(created.marketing_opt_out),
  };
}

/**
 * Mirror the ERP's view of a customer onto the CRM contact.
 *
 * Deliberately does NOT overwrite a name with an empty one, and
 * never touches `marketing_opt_out` — consent was given to this
 * channel and the ERP has no standing to revoke or restore it.
 */
export async function syncContactFromErp(
  ctx: ErpProcessContext,
  contact: ResolvedContact,
  customer: ErpCustomer,
): Promise<ContactSync> {
  const synced = await saveContactFields(ctx, contact, customer);
  await applyErpTag(ctx, contact.id);
  await applyCustomValues(ctx, contact.id, customer);
  return synced;
}

/** What `saveContactFields` left on the contact. */
export interface ContactSync {
  /**
   * The number stored on the contact now. The ONLY number a message
   * for this event may go to: the contact was read before the save,
   * so its `phone` is the number from before a correction.
   */
  phone: string;
  /**
   * The ERP's new number when it could NOT be stored because another
   * CRM contact already has it. The contact still holds the old —
   * per the ERP, wrong — number, so nothing may be sent for it.
   */
  phoneBlockedBy: string | null;
}

/**
 * Write the ERP's name, email, id and number onto the contact.
 *
 * A number change is how a wrong number gets corrected, so it is
 * never dropped silently:
 *  - saved: the caller sends to the new number, this same event;
 *  - another contact already has the number (unique index, 23505 —
 *    e.g. the customer once messaged from it): the other fields are
 *    still saved, and `phoneBlockedBy` tells the caller to send
 *    nothing rather than message the old number;
 *  - any other error: thrown, so the ERP retries the event.
 */
export async function saveContactFields(
  ctx: ErpProcessContext,
  contact: ResolvedContact,
  customer: ErpCustomer,
): Promise<ContactSync> {
  const { db, accountId } = ctx;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (customer.name) patch.name = customer.name;
  if (customer.email) patch.email = customer.email;
  if (customer.erpCustomerId) patch.erp_customer_id = customer.erpCustomerId;

  let newPhone: string | null = null;
  if (customer.phone) {
    const phone = sanitizePhoneForMeta(customer.phone);
    if (
      phone &&
      isValidE164(phone) &&
      normalizePhone(phone) !== normalizePhone(contact.phone ?? '')
    ) {
      newPhone = phone;
    }
  }

  const save = (fields: Record<string, unknown>) =>
    db
      .from('contacts')
      .update(fields)
      .eq('id', contact.id)
      .eq('account_id', accountId);

  if (!newPhone) {
    const { error } = await save(patch);
    if (error) console.warn('[erp] contact update skipped:', error.message);
    return { phone: contact.phone, phoneBlockedBy: null };
  }

  const { error } = await save({ ...patch, phone: newPhone });
  if (!error) return { phone: newPhone, phoneBlockedBy: null };

  if (!isUniqueViolation(error)) {
    throw new Error(`Failed to save the new number on the contact: ${error.message}`);
  }
  console.warn('[erp] number change blocked: another contact already has the new number');
  const { error: rest } = await save(patch);
  if (rest) console.warn('[erp] contact update skipped:', rest.message);
  return { phone: contact.phone, phoneBlockedBy: newPhone };
}

/** The ledger text for an event withheld because the new number could not be saved. */
export function blockedNumberDetail(oldPhone: string, newPhone: string): string {
  return (
    `not sent: the ERP changed this customer's number to ${newPhone}, but another CRM contact ` +
    `already has that number, so this contact still has the old one (${oldPhone}). ` +
    'Sort out the two contacts in the CRM, then resend from the ERP.'
  );
}

/** Tag the contact `erp-customer`, creating the tag on first use. */
async function applyErpTag(
  ctx: ErpProcessContext,
  contactId: string,
): Promise<void> {
  const { db, accountId } = ctx;
  try {
    const auditUserId = await resolveAuditUserId(db, accountId);
    const { tagIdByKey } = await resolveImportTagIds(db, {
      accountId,
      userId: auditUserId,
      tagNames: [ERP_CONTACT_TAG],
      canCreateTags: true,
    });
    const tagId = tagIdByKey.get(ERP_CONTACT_TAG);
    if (!tagId) return;
    await addContactTagAndDispatch({ db, accountId, contactId, tagId });
  } catch (err) {
    // A tag is a convenience, not the point of the event. Log and
    // carry on rather than making the ERP retry a delivered message.
    console.warn('[erp] tagging failed:', err);
  }
}

/**
 * Write the ERP's numeric/date attributes as contact custom values,
 * creating the custom field definitions on first use so the operator
 * does not have to pre-create four fields by hand.
 */
async function applyCustomValues(
  ctx: ErpProcessContext,
  contactId: string,
  customer: ErpCustomer,
): Promise<void> {
  const values: Array<[string, string]> = [];
  if (customer.totalSpent !== null && customer.totalSpent !== undefined) {
    values.push([CUSTOM_FIELDS.totalSpent, String(customer.totalSpent)]);
  }
  if (customer.lastPurchase) {
    values.push([CUSTOM_FIELDS.lastPurchase, customer.lastPurchase]);
  }
  if (customer.birthDate) {
    values.push([CUSTOM_FIELDS.birthDate, customer.birthDate]);
  }
  if (
    customer.pendingReferralDiscountPercent !== null &&
    customer.pendingReferralDiscountPercent !== undefined
  ) {
    values.push([
      CUSTOM_FIELDS.referralDiscount,
      String(customer.pendingReferralDiscountPercent),
    ]);
  }
  if (values.length === 0) return;

  try {
    for (const [fieldName, value] of values) {
      const fieldId = await findOrCreateCustomField(ctx, fieldName);
      if (!fieldId) continue;
      await ctx.db
        .from('contact_custom_values')
        .upsert(
          { contact_id: contactId, custom_field_id: fieldId, value },
          { onConflict: 'contact_id,custom_field_id' },
        );
    }
  } catch (err) {
    console.warn('[erp] custom values failed:', err);
  }
}

async function findOrCreateCustomField(
  ctx: ErpProcessContext,
  fieldName: string,
): Promise<string | null> {
  const { db, accountId } = ctx;
  const { data: existing } = await db
    .from('custom_fields')
    .select('id')
    .eq('account_id', accountId)
    .eq('field_name', fieldName)
    .maybeSingle();
  if (existing) return existing.id as string;

  const auditUserId = await resolveAuditUserId(db, accountId);
  const { data: created, error } = await db
    .from('custom_fields')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      field_name: fieldName,
      field_type: 'text',
    })
    .select('id')
    .single();
  if (error || !created) {
    // Another event in the same batch created it first.
    const { data: raced } = await db
      .from('custom_fields')
      .select('id')
      .eq('account_id', accountId)
      .eq('field_name', fieldName)
      .maybeSingle();
    return (raced?.id as string) ?? null;
  }
  return created.id as string;
}

// ------------------------------------------------------------
// Stores
// ------------------------------------------------------------

/**
 * Link the contact to the store that served this order.
 *
 * This is the whole reason the ERP integration matters for staff
 * isolation: `contact_stores` is the security boundary (migration
 * 043), and a sales order in the ERP is the trusted event that says
 * "this customer belongs to this branch" — hence `source = 'erp'`.
 *
 * The branch arrives as a display name ("Shastri Nagar"); we match it
 * against both the store name and the short code, case- and
 * space-insensitively, because the two systems were named by
 * different people at different times ("Shastri" vs "Shashtri").
 *
 * An unmatched branch never fails the event: the message still needs
 * to go out, and a contact with no store link is visible to
 * owner/admin, who can assign it by hand. But it is not silent
 * either — the reason comes back to the caller, which writes it into
 * the event ledger so `/api/erp/status` can show it. A branch that
 * quietly matches nothing is how a whole store's customers end up
 * unfiled with no error anywhere, so "logged to stderr" is not
 * enough: the operator cannot read stderr.
 */
export async function linkContactToBranch(
  ctx: ErpProcessContext,
  contactId: string,
  branch: string,
  /**
   * The branch's Google review link as the ERP holds it, when the
   * event carried one. Written through to the store, never read from
   * here for the message itself — see `syncStoreReviewUrl`.
   */
  erpReviewUrl?: string | null,
): Promise<StoreLinkResult> {
  const { db, accountId } = ctx;
  const { data: stores } = await db
    .from('stores')
    .select('id, name, code, phone, review_url')
    .eq('account_id', accountId)
    .eq('active', true);
  if (!stores || stores.length === 0) {
    return { linked: false, reason: `${UNMATCHED_BRANCH}${branch} (no active stores)` };
  }

  const match = matchStoreByBranch(stores, branch);
  if (!match) {
    console.warn('[erp] no store matches branch', { branch, accountId });
    return { linked: false, reason: `${UNMATCHED_BRANCH}${branch}` };
  }

  const { error } = await db.from('contact_stores').upsert(
    {
      contact_id: contactId,
      store_id: match.id,
      account_id: accountId,
      source: 'erp',
    },
    { onConflict: 'contact_id,store_id' },
  );
  if (error) {
    console.warn('[erp] store link failed:', error.message);
    return {
      linked: false,
      reason: `store link failed for branch ${branch}: ${error.message}`,
    };
  }
  const storeReviewUrl = await syncStoreReviewUrl(
    ctx,
    String(match.id),
    typeof match.review_url === 'string' ? match.review_url : null,
    erpReviewUrl,
  );

  return {
    linked: true,
    storeId: String(match.id),
    storeName: String(match.name),
    storeCode: String(match.code),
    storePhone: typeof match.phone === 'string' && match.phone.trim()
      ? match.phone.trim()
      : null,
    storeReviewUrl,
  };
}

/**
 * Keep the store's Google review link in step with the ERP's.
 *
 * The ERP is the source of truth: the links are entered once in
 * Staff & Stores, which also turns a bare Place ID or a `g.page/r/…`
 * share link into one that opens the review box rather than the shop
 * page. Two copies of a link drift, and the half nobody edited is
 * the half that sends.
 *
 * It can only SET or CHANGE a link, never clear one. An event
 * arriving without the field — an older ERP build, or a store whose
 * link has not been pasted in yet — must not wipe a link an operator
 * typed into Settings -> Stores. "The ERP said nothing" is not the
 * same as "the ERP said none", and only one of those is a reason to
 * stop asking customers for reviews.
 *
 * Returns the link the caller should treat as current, so a store
 * whose link arrives on this very event is usable on this very
 * message rather than the next one.
 */
async function syncStoreReviewUrl(
  ctx: ErpProcessContext,
  storeId: string,
  current: string | null,
  incoming: string | null | undefined,
): Promise<string | null> {
  const existing = current?.trim() || null;
  const next = incoming?.trim() || null;
  if (!next || next === existing) return existing;

  const { error } = await ctx.db
    .from('stores')
    .update({ review_url: next })
    .eq('id', storeId)
    .eq('account_id', ctx.accountId);
  if (error) {
    // Not fatal. The order's own message does not depend on it, and
    // the previous link — if any — still works.
    console.warn('[erp] store review_url sync failed:', error.message);
    return existing;
  }
  return next;
}

/** Lowercase, strip everything that is not a letter or a digit. */
export function normalizeStoreKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The store a branch name refers to, or null.
 *
 * The ERP spells a branch however the till spells it — 'Shastri
 * Nagar', 'shastri-nagar', or the short code 'SHNR' — so both the
 * name and the code are compared through `normalizeStoreKey`.
 *
 * An empty or punctuation-only branch matches nothing rather than
 * the first store whose code normalises to '', which is the kind of
 * accident that files a customer under the wrong shop.
 */
export function matchStoreByBranch<T extends { name?: unknown; code?: unknown }>(
  stores: T[],
  branch: string,
): T | null {
  const key = normalizeStoreKey(branch);
  if (!key) return null;
  return (
    stores.find(
      (s) =>
        normalizeStoreKey(String(s.name ?? '')) === key ||
        normalizeStoreKey(String(s.code ?? '')) === key,
    ) ?? null
  );
}

// ------------------------------------------------------------
// One event, end to end
// ------------------------------------------------------------

export async function processErpEvent(
  ctx: ErpProcessContext,
  event: ErpEvent,
): Promise<ErpEventOutcome> {
  if (event.type === 'ping') {
    return { status: 'done', detail: 'ping' };
  }
  if (!isKnownEventType(event.type)) {
    return { status: 'skipped', detail: `unknown event type: ${event.type}` };
  }

  const customer = extractCustomer(event);
  if (!customer) {
    return { status: 'skipped', detail: 'event carries no customer' };
  }

  const contact = await findOrCreateErpContact(ctx, customer);
  if (!contact) {
    return { status: 'skipped', detail: 'customer has no valid phone number' };
  }

  const synced = await syncContactFromErp(ctx, contact, customer);

  const branch = extractBranch(event);
  // Every return below carries the filing outcome, because "the
  // message went out" and "the customer was filed to a store" are
  // two different things and only the ledger can tell the operator
  // the second one happened.
  const link = branch
    ? await linkContactToBranch(
        ctx,
        contact.id,
        branch,
        extractBranchReviewUrl(event),
      )
    : null;
  const note = storeLinkNote(link);
  // The bill number, for Message activity's search and for the row
  // itself. Same key the review queue uses, so one order reads the
  // same in both places.
  const orderRef = reviewOrderKey(event.data);

  // `customer.upsert` is a data event: it keeps the CRM in step with
  // the ERP and deliberately sends nothing.
  if (event.type === 'customer.upsert') {
    return {
      status: 'done',
      detail: withNote(
        synced.phoneBlockedBy
          ? `contact synced, but NOT its new number: ${blockedNumberDetail(synced.phone, synced.phoneBlockedBy).replace(/^not sent: /, '')}`
          : 'contact synced',
        note,
      ),
      contactId: contact.id,
      branch,
      orderRef,
    };
  }

  // The ERP corrected this customer's number but the CRM could not
  // store it. The contact still holds the number the ERP says is
  // wrong, so sending would message a stranger. Before every other
  // reason not to send, so the ledger names the cause staff can fix.
  if (synced.phoneBlockedBy) {
    return {
      status: 'skipped',
      detail: withNote(blockedNumberDetail(synced.phone, synced.phoneBlockedBy), note),
      contactId: contact.id,
      branch,
      orderRef,
    };
  }

  // The send gate. Deliberately AFTER the contact and the store
  // link: a held-back branch's customers still appear in the CRM,
  // still belong to their store, and their staff still see them.
  // Only the outgoing message is withheld, which is what makes a
  // one-branch trial a trial rather than a partial rollout.
  const gate = shouldSendForBranch(branch, ctx.allowedBranches);
  if (!gate.send) {
    return {
      status: 'skipped',
      detail: withNote(gate.reason, note),
      contactId: contact.id,
      branch,
      orderRef,
    };
  }

  if (isMarketingEvent(event.type) && contact.marketingOptOut) {
    return {
      status: 'skipped',
      detail: withNote('contact opted out of marketing', note),
      contactId: contact.id,
      branch,
      orderRef,
    };
  }

  // Every approved template closes by naming the branch's own phone
  // number, so a store with no number cannot send. Checked here, by
  // name, because "no template mapped" would send the operator
  // hunting through template settings for a missing field in
  // Settings -> Stores.
  const branchPhone = link?.linked ? link.storePhone : null;
  if (requiresBranchPhone(event.type) && !branchPhone) {
    return {
      status: 'skipped',
      detail: withNote(
        link?.linked
          ? `store ${link.storeName} has no contact number: set it in Settings -> Stores`
          : 'cannot tell which store is sending, so there is no contact number for the message',
        note,
      ),
      contactId: contact.id,
      branch,
      orderRef,
    };
  }

  // The ERP sending its own review request for an order we already
  // queued must not produce two asks. Done before the send, so the
  // row is closed even if the send then fails.
  if (event.type === 'order.review') {
    const orderKey = reviewOrderKey(event.data);
    if (orderKey) await supersedeQueuedReview(ctx.db, ctx.accountId, orderKey);
  }

  // The branch's own Google listing wins over the account-wide link,
  // the same precedence the queue drain and /r/<id> already use.
  // Resolved here rather than read straight off ctx: `ctx.reviewUrl`
  // is only the ACCOUNT-wide fallback, so gating on it alone skipped
  // a branch that has its own listing whenever that field sat empty
  // — the normal state while the links are collected one shop at a
  // time.
  const reviewLink = resolveReviewUrl(
    link?.linked ? link.storeReviewUrl : null,
    ctx.reviewUrl,
  );

  const plan = templatePlanFor(event, {
    currency: ctx.currency,
    reviewUrl: reviewLink,
    branchPhone,
  });
  if (!plan) {
    return {
      status: 'skipped',
      detail: withNote(
        event.type === 'order.review'
          ? link?.linked
            ? `no review link for ${link.storeName}, and no account-wide link to fall back on: set one in Settings -> Stores`
            : 'no review link is configured: set one in Settings -> Stores, or an account-wide one in Settings -> Automatic messages'
          : 'no template mapped for this event',
        note,
      ),
      contactId: contact.id,
      branch,
      orderRef,
    };
  }

  // An attachment variant that Meta has not approved cannot send. The
  // ERP now puts a receipt link on every order, so without this every
  // order would pick the _doc template and fail — the plain version
  // would never be reached, which is the opposite of the graceful
  // degradation this pair was designed for.
  const usable = await downgradeToApprovedTemplate(ctx, plan);

  const { conversationId } = await resolveConversationByPhone(
    ctx.db,
    ctx.accountId,
    // The number saved above, not the one read before the save: when
    // this event corrected a wrong number, `contact.phone` is still
    // the wrong one.
    synced.phone,
    customer.name ?? null,
  );

  let whatsappMessageId: string | undefined;
  let messageId: string | undefined;
  try {
    const sendResult = await sendMessageToConversation(ctx.db, ctx.accountId, {
      conversationId,
      messageType: 'template',
      templateName: usable.templateName,
      templateParams: usable.params,
      // The structured form is what carries a DOCUMENT header and a URL
      // button through to Meta; `templateParams` alone reaches the body
      // only. Passed only when there is something to put in it, so the
      // plain templates keep the simpler, well-tested path.
        templateMessageParams: buildSendParams(
        usable,
        link?.linked ? link.storeId : null,
      ),
    });
    whatsappMessageId = sendResult.whatsappMessageId ?? undefined;
    messageId = sendResult.messageId ?? undefined;
  } catch (err) {
    // Meta's own errors name neither the template nor the attachment:
    // "(#132001) Template name does not exist in the translation" is
    // the same string whichever template was tried. That left the
    // ledger unable to answer the question a failed send most often
    // raises — WHICH message was this, and did it carry its PDF.
    throw new Error(sendFailureDetail(usable, err));
  }

  // A delivery owes a review request, a few days from now. Queued
  // AFTER the send so a failed delivery message does not leave a
  // review ask behind for an order the customer never heard about.
  const queued = await queueReviewIfHandedOver(ctx, event, contact.id, branch);

  const downgraded =
    usable.templateName !== plan.templateName
      ? ` (${plan.templateName} is not approved, so no attachment)`
      : '';

  return {
    status: 'done',
    detail: withNote(
      queued
        ? `sent ${usable.templateName}${downgraded} | review request due ${queued}`
        : `sent ${usable.templateName}${downgraded}`,
      note,
    ),
    contactId: contact.id,
    whatsappMessageId,
    messageId,
    branch,
    orderRef,
  };
}

/**
 * The events after which the customer has their purchase.
 *
 * Both owe a review request, and a counter sale arguably sooner —
 * there is no lens to adapt to. Keying on `order.delivered` alone
 * would have asked every spectacles customer and no sunglasses
 * customer, silently, for as long as nobody counted.
 */
const HANDS_OVER_THE_ORDER = new Set(['order.delivered', 'order.sold']);

/**
 * Queue the review request owed once the customer has their order,
 * and report the day it falls due for the ledger.
 *
 * Returns null — and records nothing — when the customer does not
 * have the order yet, or when it carries no identifier we can make
 * unique. That
 * second case is worth being strict about: without a key, every
 * unidentified order in the account would collide on one queue row.
 *
 * It deliberately does NOT check for a review link. The link that
 * matters is the serving branch's, it is read at send time days
 * later, and it may well be filled in between — so refusing to queue
 * over a link missing today throws away an ask that would have been
 * sendable. The drain is the single place that decides, and it
 * records WHICH store is missing a link somewhere an operator can
 * read it. Dropping the row here recorded nothing at all, which is
 * how "no review message ever arrived" became unanswerable.
 */
export async function queueReviewIfHandedOver(
  ctx: ErpProcessContext,
  event: ErpEvent,
  contactId: string,
  branch: string | null,
): Promise<string | null> {
  if (!HANDS_OVER_THE_ORDER.has(event.type)) return null;

  const orderKey = reviewOrderKey(event.data);
  if (!orderKey) return null;

  const dueAt = await enqueueReviewRequest(ctx.db, {
    accountId: ctx.accountId,
    contactId,
    orderKey,
    branch,
    delayDays: ctx.reviewDelayDays,
  });
  return dueAt ? dueAt.toISOString().slice(0, 10) : null;
}

/**
 * Swap an attachment template for its plain twin when Meta has not
 * approved the attachment one.
 *
 * Checked against the CRM's own template list, which mirrors Meta's
 * status. A template that is missing or not APPROVED cannot send, and
 * failing the whole message over an attachment the customer never
 * asked for is the wrong trade: the confirmation matters, the PDF is
 * a bonus.
 *
 * Returns the plan unchanged when there is no attachment, no plain
 * twin, or the variant is approved.
 */
export async function downgradeToApprovedTemplate(
  ctx: ErpProcessContext,
  plan: TemplatePlan,
): Promise<TemplatePlan> {
  if (!plan.documentUrl) return plan;
  const plain = plainTemplateFor(plan.templateName);
  if (!plain) return plan;

  const { data } = await ctx.db
    .from('message_templates')
    .select('status')
    .eq('account_id', ctx.accountId)
    .eq('name', plan.templateName);

  const approved = (data ?? []).some(
    (row) => String((row as { status?: unknown }).status ?? '').toUpperCase() === 'APPROVED',
  );
  if (approved) return plan;

  // Same body params either way — the two templates differ only in the
  // header, which is why they can stand in for each other at all.
  return { templateName: plain, params: plan.params };
}

/**
 * What to record in the ledger when a send fails.
 *
 * Names the template that was attempted and whether it carried its
 * attachment, then the underlying error. Without this the ledger
 * holds only Meta's message, which is identical for every template
 * and says nothing about the document header — so a failure could
 * not distinguish `order_confirmation` from `order_confirmation_doc`,
 * which is exactly how you tell whether the ERP's PDF link was
 * picked up.
 */
export function sendFailureDetail(plan: TemplatePlan, err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  const attachment = plan.documentUrl
    ? ` with ${plan.documentFilename ?? 'an attachment'}`
    : '';
  return `sending ${plan.templateName}${attachment} failed: ${reason}`;
}

/**
 * The structured send params for a plan, or undefined when the plan
 * needs none.
 *
 * `review_request` puts the review link on its URL button rather than
 * in the body, so the link is a button param, not a body param. Index
 * 0 is that template's only button.
 */
export function buildSendParams(
  plan: TemplatePlan,
  reviewStoreId?: string | null,
): Record<string, unknown> | undefined {
  const params: Record<string, unknown> = {};
  if (plan.documentUrl) {
    params.headerMediaUrl = plan.documentUrl;
    if (plan.documentFilename) params.headerFilename = plan.documentFilename;
  }
  // The review button's URL is `https://<host>/r/{{1}}`, and this is
  // the {{1}}. Meta allows one variable on a URL button and only as a
  // suffix on a fixed base, so the branch's own Google link cannot go
  // here — four shops have four unrelated links and there is no fixed
  // base to hang them off. /r/<store id> resolves it instead.
  if (plan.templateName === 'review_request' && reviewStoreId?.trim()) {
    params.buttonParams = { 0: reviewStoreId.trim() };
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Turn a filing outcome into the clause appended to the ledger
 * detail. `null` — the event named no branch at all — is deliberately
 * silent: most non-order events carry no branch and saying so on
 * every row would bury the rows that matter.
 */
export function storeLinkNote(link: StoreLinkResult | null): string | null {
  if (!link) return null;
  if (link.linked) return `filed to ${link.storeName}`;
  return link.reason;
}

/**
 * Join a detail and its filing note into one ledger line.
 *
 * `detail` is optional because the send gate's decision carries no
 * reason when it lets an event through; the note alone is still worth
 * recording in that case.
 */
export function withNote(
  detail: string | undefined,
  note: string | null,
): string | undefined {
  if (!note) return detail;
  return detail ? `${detail} | ${note}` : note;
}
