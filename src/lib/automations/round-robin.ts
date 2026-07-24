/**
 * Round-robin deal assignment — picks whichever teammate currently has
 * the fewest open deals, so a burst of new leads spreads across the
 * team instead of piling onto whoever the automation happened to name.
 *
 * `assign_conversation`'s existing "round_robin" mode (engine.ts) isn't
 * a real rotation — it always returns the account's first member; the
 * code says as much. This is a genuine implementation for deals, kept
 * in its own module so it's testable without the rest of the engine.
 * Load-based rather than a stored "last assigned index": it needs no
 * extra state column, self-corrects if a deal gets reassigned by hand,
 * and produces the same practical effect (an even spread) that a
 * strict turn-taking rotation would.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

/**
 * Resolve the account member with the fewest currently-open deals.
 * Ties broken by profile creation order, so the choice is deterministic
 * (and stable in tests) rather than depending on object iteration order.
 *
 * Returns null when the account has no members to assign to — callers
 * treat that as "no agent resolved," same as assign_conversation.
 */
export async function pickRoundRobinDealAssignee(
  db: DB,
  accountId: string,
): Promise<string | null> {
  const { data: members } = await db
    .from('profiles')
    .select('id')
    .eq('account_id', accountId)
    .order('created_at')

  if (!members || members.length === 0) return null
  if (members.length === 1) return members[0].id as string

  const { data: openDeals } = await db
    .from('deals')
    .select('assigned_to')
    .eq('account_id', accountId)
    .eq('status', 'open')
    .not('assigned_to', 'is', null)

  const loadByMember = new Map<string, number>(
    (members as { id: string }[]).map((m) => [m.id, 0]),
  )
  for (const deal of (openDeals ?? []) as { assigned_to: string }[]) {
    if (loadByMember.has(deal.assigned_to)) {
      loadByMember.set(deal.assigned_to, (loadByMember.get(deal.assigned_to) ?? 0) + 1)
    }
  }

  let winner = (members[0] as { id: string }).id
  let winnerLoad = loadByMember.get(winner) ?? 0
  for (const member of members.slice(1) as { id: string }[]) {
    const load = loadByMember.get(member.id) ?? 0
    if (load < winnerLoad) {
      winner = member.id
      winnerLoad = load
    }
  }
  return winner
}

/**
 * Resolve a specific-mode assignee to the `profiles.id` that
 * `deals.assigned_to` expects.
 *
 * The step-config pickers (AgentSelect, shared with assign_conversation)
 * offer teammates by `auth.users.id` — the same id `/api/account/members`
 * returns and the same one `conversations.assigned_agent_id` stores
 * directly. `deals.assigned_to` instead references `profiles(id)`
 * (migration 002), so a "specific" pick has to cross that translation
 * before it can be written; round-robin doesn't, since
 * `pickRoundRobinDealAssignee` already returns a profile id.
 */
export async function resolveAssigneeProfileId(
  db: DB,
  accountId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await db
    .from('profiles')
    .select('id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}
