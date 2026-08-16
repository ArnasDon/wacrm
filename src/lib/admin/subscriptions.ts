import type { SupabaseClient } from '@supabase/supabase-js'

const OVERDUE_REASON = 'Pago pendiente'

export interface OverdueAccount {
  id: string
  name: string
  next_payment_due_at: string
}

/**
 * Accounts whose `next_payment_due_at` has passed and aren't already
 * suspended. NULL due dates never match — that's "no billing cycle
 * assigned yet," not "overdue." Pure read, no side effects — used both
 * for the cron's dry-run mode and internally by `suspendOverdueAccounts`.
 */
export async function findOverdueAccounts(db: SupabaseClient): Promise<OverdueAccount[]> {
  const { data, error } = await db
    .from('accounts')
    .select('id, name, next_payment_due_at')
    .not('next_payment_due_at', 'is', null)
    .lt('next_payment_due_at', new Date().toISOString())
    .is('suspended_at', null)
  if (error) throw error
  return (data ?? []) as OverdueAccount[]
}

/**
 * Suspends every currently-overdue account (see `findOverdueAccounts`)
 * with `suspended_reason = 'Pago pendiente'` — the same
 * `suspended_at`/`suspended_reason` columns migration 044 wired into
 * `is_account_member()`, so this takes effect exactly like a manual
 * suspend from /admin. Never touches an account already suspended for
 * any reason (manual or otherwise).
 */
export async function suspendOverdueAccounts(
  db: SupabaseClient,
): Promise<{ suspended: { id: string; name: string }[] }> {
  const overdue = await findOverdueAccounts(db)
  if (overdue.length === 0) return { suspended: [] }

  const ids = overdue.map((a) => a.id)
  const { error } = await db
    .from('accounts')
    .update({ suspended_at: new Date().toISOString(), suspended_reason: OVERDUE_REASON })
    .in('id', ids)
  if (error) throw error

  return { suspended: overdue.map((a) => ({ id: a.id, name: a.name })) }
}

export interface MarkPaidResult {
  next_payment_due_at: string
  last_marked_paid_at: string
  suspended_at: string | null
  suspended_reason: string | null
}

/**
 * "Marcar como pagada" — records the payment and advances the billing
 * cycle by one month. Advances from the current `next_payment_due_at`
 * when it's still in the future (paying early doesn't lose the
 * remainder of the current cycle); otherwise advances from now (an
 * overdue or never-set cycle starts fresh from today, so it can't
 * compound a stale date). If the account was suspended specifically
 * for non-payment (`suspended_reason === 'Pago pendiente'` — the exact
 * string both this module and the manual /admin suspend flow use), it
 * is un-suspended; a manual suspension for any other reason is left
 * alone, since paying doesn't override an unrelated admin decision.
 */
export async function markAccountPaid(db: SupabaseClient, accountId: string): Promise<MarkPaidResult> {
  const { data: account, error: fetchError } = await db
    .from('accounts')
    .select('next_payment_due_at, suspended_at, suspended_reason')
    .eq('id', accountId)
    .maybeSingle()
  if (fetchError) throw fetchError
  if (!account) throw new Error('Account not found')

  const now = new Date()
  const currentDue = account.next_payment_due_at ? new Date(account.next_payment_due_at as string) : null
  const base = currentDue && currentDue > now ? currentDue : now
  const nextDue = new Date(base)
  nextDue.setMonth(nextDue.getMonth() + 1)

  const update: Record<string, unknown> = {
    last_marked_paid_at: now.toISOString(),
    next_payment_due_at: nextDue.toISOString(),
  }
  if (account.suspended_at && account.suspended_reason === OVERDUE_REASON) {
    update.suspended_at = null
    update.suspended_reason = null
  }

  const { data, error: updateError } = await db
    .from('accounts')
    .update(update)
    .eq('id', accountId)
    .select('next_payment_due_at, last_marked_paid_at, suspended_at, suspended_reason')
    .single()
  if (updateError) throw updateError
  return data as MarkPaidResult
}
