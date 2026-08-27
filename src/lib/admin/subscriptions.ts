import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'

const OVERDUE_REASON = 'Pago pendiente'
const PAYMENTS_INBOX = 'asistentedechat@gmail.com'
const MS_PER_DAY = 86_400_000

function formatDueDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-GT', { year: 'numeric', month: 'long', day: 'numeric' })
}

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
 * Accounts whose `next_payment_due_at` falls exactly `days` calendar
 * days from today (UTC date, not a 24h-window check — so a due date at
 * any time of day still matches on the right calendar day regardless of
 * what time the cron happens to run), and aren't already suspended.
 * Used for the early warning email (days=3) — fires once, three days
 * before the due date.
 */
export async function findAccountsDueInDays(
  db: SupabaseClient,
  days: number,
): Promise<OverdueAccount[]> {
  const { data, error } = await db
    .from('accounts')
    .select('id, name, next_payment_due_at')
    .not('next_payment_due_at', 'is', null)
    .is('suspended_at', null)
  if (error) throw error

  const today = new Date()
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())

  return ((data ?? []) as OverdueAccount[]).filter((a) => {
    const due = new Date(a.next_payment_due_at)
    const dueUTC = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())
    return Math.round((dueUTC - todayUTC) / MS_PER_DAY) === days
  })
}

/**
 * Angel decided against auto-suspending accounts (2026-08-16) — he wants
 * to review and suspend by hand, not have it happen silently. This
 * sends him two kinds of email alert instead, both to PAYMENTS_INBOX,
 * and mutates nothing:
 *
 *   - "due soon": accounts hitting their 3-day warning today (fires
 *     once, since the day-diff check only ever matches on that one day).
 *   - "overdue": accounts already past due and still active (fires
 *     every day the cron runs until Angel marks it paid or suspends it
 *     by hand from /admin — a one-shot "last day" email risks getting
 *     lost if he's away that day, so this keeps nudging instead of
 *     going silent).
 */
export async function sendSubscriptionAlerts(
  db: SupabaseClient,
): Promise<{ dueSoon: string[]; overdue: string[] }> {
  const [dueSoon, overdue] = await Promise.all([
    findAccountsDueInDays(db, 3),
    findOverdueAccounts(db),
  ])

  if (dueSoon.length > 0) {
    await sendEmail({
      account: 'payments',
      to: PAYMENTS_INBOX,
      subject: `Pagos por vencer en 3 días — ${dueSoon.length} empresa(s)`,
      text: dueSoon
        .map((a) => `${a.name} — vence el ${formatDueDate(a.next_payment_due_at)}`)
        .join('\n'),
    })
  }

  if (overdue.length > 0) {
    await sendEmail({
      account: 'payments',
      to: PAYMENTS_INBOX,
      subject: `Pago vencido — ${overdue.length} empresa(s) por suspender manualmente`,
      text: overdue
        .map((a) => `${a.name} — venció el ${formatDueDate(a.next_payment_due_at)}`)
        .join('\n') + '\n\nSuspéndelas desde /admin cuando quieras (botón "Suspender").',
    })
  }

  return { dueSoon: dueSoon.map((a) => a.name), overdue: overdue.map((a) => a.name) }
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
/**
 * One calendar month after `base`, keeping the time of day. A bare
 * `setMonth(+1)` overflows for month-end dates — Jan 31 → "Feb 31" →
 * rolls forward to Mar 3, silently skipping a whole billing month. This
 * clamps the day to the last day of the target month instead, so a due
 * date on the 31st lands on Feb 28/29, Apr 30, etc. and the day-of-month
 * is restored the following month.
 */
export function addOneMonth(base: Date): Date {
  const day = base.getDate()
  const result = new Date(base)
  // Move to the 1st first so changing the month can't itself roll over.
  result.setDate(1)
  result.setMonth(result.getMonth() + 1)
  const lastDayOfTargetMonth = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate()
  result.setDate(Math.min(day, lastDayOfTargetMonth))
  return result
}

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
  const nextDue = addOneMonth(base)

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
