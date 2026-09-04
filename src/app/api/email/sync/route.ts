import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { syncContacts, type SyncableContact } from '@/lib/listmonk/sync';
import { toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';

/**
 * Cap per invocation. A sync is two listmonk round trips per contact,
 * so an unbounded run over a large book would outlive the request.
 * The UI syncs in pages and reports cumulative totals.
 */
const MAX_PER_RUN = 500;

export const maxDuration = 60;

/**
 * POST /api/email/sync  { list_ids: number[], offset?: number }
 *
 * Pushes this account's contacts into listmonk as subscribers.
 * Contacts without an email address are skipped and counted — see
 * the note in lib/listmonk/sync.ts on why that asymmetry exists.
 */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const listIds: number[] = Array.isArray(body?.list_ids)
    ? body.list_ids
        .map(Number)
        .filter((n: number) => Number.isInteger(n) && n > 0)
    : [];

  if (listIds.length === 0) {
    return NextResponse.json(
      { error: 'list_ids is required' },
      { status: 400 }
    );
  }

  const offset =
    Number.isInteger(body?.offset) && body.offset >= 0 ? body.offset : 0;

  // RLS scopes both queries to the caller's account — no explicit
  // account_id filter needed, and none possible to forget.
  //
  // Contacts with no email are excluded in SQL rather than fetched
  // and skipped in JS. That keeps the sync cheap, but it means the
  // `skipped` counter from syncContacts() only ever counts contacts
  // whose email is present but malformed. Reporting that as "skipped
  // (no email)" would be a lie, so we count the emailless population
  // separately and return it as its own field.
  const [{ data, error, count }, withoutEmail] = await Promise.all([
    ctx.supabase
      .from('contacts')
      .select('id, name, email, phone, company', { count: 'exact' })
      .not('email', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + MAX_PER_RUN - 1),
    ctx.supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .is('email', null),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const contacts = (data ?? []) as SyncableContact[];

  try {
    const result = await syncContacts(contacts, ctx.accountId, listIds);
    const nextOffset = offset + contacts.length;
    return NextResponse.json({
      ...result,
      processed: contacts.length,
      total_with_email: count ?? 0,
      // Contacts that can never become subscribers, so an operator
      // can see why "sync 500 contacts" produced fewer subscribers.
      without_email: withoutEmail.count ?? 0,
      next_offset: nextOffset < (count ?? 0) ? nextOffset : null,
    });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
