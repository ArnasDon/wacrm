// ============================================================
// POST /api/v1/lulu/customers/sync   (scope: contacts:write)
//
// BigQuery → WACRM customer sync (PRD §86-87). Called on a schedule by
// n8n / a script. Upserts a *read-model* of the fields the CRM needs into
// `lulu_customer_profiles`, links each profile to its WACRM contact by
// phone, and (optionally) creates missing contacts.
//
// Body:
//   { "data_as_of": "2026-09-30T12:49:53Z",   (optional; else taken from rows)
//     "customers": [ { customer_id, mobile, name, language, birthday,
//                      last_order_date, total_orders, total_sales,
//                      median_interval_days, vip_flag, marketing_opt_in, ... } ],
//     "create_contacts": false }
//
// Rules
//   - Max 500 customers per request (key limit is 120 req/min).
//   - Opt-out is STICKY: a profile already marked marketing_opt_in=false
//     can never be flipped back to true by a sync (a customer's STOP must
//     win over a stale warehouse snapshot). Re-opt-in is a manual action.
//   - lifecycle_stage is computed here by the engine unless overridden.
//   - Idempotent: re-sending the same batch is safe.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  MAX_SYNC_BATCH,
  extractDataAsOf,
  parseCustomer,
  type ProfileRow,
  type SyncRowError,
} from '@/lib/lulu/sync';

const CONTACT_CREATE_CONCURRENCY = 10;
const LOOKUP_CHUNK = 200;

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');
    const db = ctx.supabase;
    const accountId = ctx.accountId;

    const body = (await request.json().catch(() => null)) as {
      customers?: unknown;
      create_contacts?: unknown;
      data_as_of?: unknown;
    } | null;
    if (!body || !Array.isArray(body.customers)) {
      return fail('bad_request', "Body must be { customers: [...] }", 400);
    }
    if (body.customers.length === 0) {
      return fail('bad_request', "'customers' must not be empty", 400);
    }
    if (body.customers.length > MAX_SYNC_BATCH) {
      return fail(
        'bad_request',
        `Too many customers in one request (max ${MAX_SYNC_BATCH})`,
        400
      );
    }
    const createContacts = body.create_contacts === true;
    const now = new Date();

    // 1. Validate + derive rows (last occurrence of a customer_id wins).
    const errors: SyncRowError[] = [];
    const byId = new Map<string, ProfileRow>();
    body.customers.forEach((raw, index) => {
      const parsed = parseCustomer(raw, now);
      if (typeof parsed === 'string') {
        const cid = (raw as { customer_id?: unknown } | null)?.customer_id;
        errors.push({
          index,
          customer_id: cid == null ? null : String(cid),
          error: parsed,
        });
      } else {
        byId.set(parsed.customer_id, parsed);
      }
    });
    const rows = [...byId.values()];

    const { data: logRow } = await db
      .from('lulu_customer_sync_log')
      .insert({
        account_id: accountId,
        rows_received: body.customers.length,
        data_as_of: extractDataAsOf(body.data_as_of, body.customers),
      })
      .select('id')
      .single();

    if (rows.length === 0) {
      if (logRow) {
        await db
          .from('lulu_customer_sync_log')
          .update({
            finished_at: new Date().toISOString(),
            rows_failed: errors.length,
            status: 'FAILED',
            error: 'No valid rows',
          })
          .eq('id', logRow.id);
      }
      return ok({ received: body.customers.length, upserted: 0, failed: errors.length, errors: errors.slice(0, 50) }, 422);
    }

    // 2. Sticky opt-out: look up existing opted-out profiles.
    const optedOut = new Set<string>();
    for (let i = 0; i < rows.length; i += LOOKUP_CHUNK) {
      const ids = rows.slice(i, i + LOOKUP_CHUNK).map((r) => r.customer_id);
      const { data } = await db
        .from('lulu_customer_profiles')
        .select('customer_id')
        .eq('account_id', accountId)
        .eq('marketing_opt_in', false)
        .in('customer_id', ids);
      for (const r of data ?? []) optedOut.add(r.customer_id as string);
    }
    for (const r of rows) if (optedOut.has(r.customer_id)) r.marketing_opt_in = false;

    // 3. Link to WACRM contacts by normalized phone (digits-only column).
    const contactByDigits = new Map<string, string>();
    const digitsOf = (mobile: string) => normalizePhone(mobile);
    for (let i = 0; i < rows.length; i += LOOKUP_CHUNK) {
      const digits = rows.slice(i, i + LOOKUP_CHUNK).map((r) => digitsOf(r.mobile));
      const { data } = await db
        .from('contacts')
        .select('id, phone_normalized')
        .eq('account_id', accountId)
        .in('phone_normalized', digits);
      for (const c of data ?? []) {
        contactByDigits.set(c.phone_normalized as string, c.id as string);
      }
    }

    let contactsCreated = 0;
    if (createContacts) {
      const missing = rows.filter((r) => !contactByDigits.has(digitsOf(r.mobile)));
      if (missing.length > 0) {
        const auditUserId = await resolveAuditUserId(db, accountId);
        for (let i = 0; i < missing.length; i += CONTACT_CREATE_CONCURRENCY) {
          await Promise.all(
            missing.slice(i, i + CONTACT_CREATE_CONCURRENCY).map(async (r) => {
              try {
                const { id, created } = await findOrCreateContact(db, accountId, auditUserId, {
                  phone: r.mobile,
                  name: r.name,
                });
                contactByDigits.set(digitsOf(r.mobile), id);
                if (created) contactsCreated++;
              } catch (e) {
                console.error('[lulu/sync] contact create failed:', r.customer_id, e);
              }
            })
          );
        }
      }
    }

    // 4. Upsert profiles (single round-trip).
    const syncedAt = now.toISOString();
    const payload = rows.map((r) => ({
      ...r,
      account_id: accountId,
      contact_id: contactByDigits.get(digitsOf(r.mobile)) ?? null,
      synced_at: syncedAt,
    }));
    const { error: upsertError } = await db
      .from('lulu_customer_profiles')
      .upsert(payload, { onConflict: 'account_id,customer_id' });

    if (upsertError) {
      console.error('[api/v1/lulu/customers/sync] upsert error:', upsertError);
      if (logRow) {
        await db
          .from('lulu_customer_sync_log')
          .update({
            finished_at: new Date().toISOString(),
            rows_failed: body.customers.length,
            status: 'FAILED',
            error: upsertError.message,
          })
          .eq('id', logRow.id);
      }
      return fail('internal', 'Failed to save customers', 500);
    }

    const linked = payload.filter((p) => p.contact_id).length;
    if (logRow) {
      await db
        .from('lulu_customer_sync_log')
        .update({
          finished_at: new Date().toISOString(),
          rows_upserted: payload.length,
          rows_failed: errors.length,
          status: errors.length > 0 ? 'PARTIAL' : 'OK',
        })
        .eq('id', logRow.id);
    }

    return ok({
      received: body.customers.length,
      upserted: payload.length,
      failed: errors.length,
      contacts_linked: linked,
      contacts_created: contactsCreated,
      opted_out_preserved: optedOut.size,
      errors: errors.slice(0, 50),
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
