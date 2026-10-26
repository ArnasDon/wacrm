/**
 * Agent pool + pick logic for the `assign_conversation` step's round-robin
 * mode. Kept free of I/O so the rules are testable on their own; the engine
 * supplies the rows.
 */

export type RotationRole = 'owner' | 'admin' | 'agent' | 'viewer';

export interface RotationMember {
  user_id: string;
  role: RotationRole;
}

/**
 * Who rotation targets when the step names no one explicitly. Owners are
 * excluded on purpose — an owner is an account holder, not a queue worker,
 * and the previous implementation handing them every conversation is the
 * bug this replaces. Viewers cannot reply at all, so they are out too.
 */
const DEFAULT_ROTATION_ROLES: readonly RotationRole[] = ['admin', 'agent'];

/**
 * The members a round-robin step rotates between, in a stable order.
 *
 * `configuredIds` (the step's `agent_ids`) wins when it names at least one
 * current member — that is the author saying "these three people". Otherwise
 * every admin/agent in the account takes part. An account whose only member
 * is its owner falls back to that owner: assigning to someone beats leaving
 * the conversation unassigned.
 */
export function rotationPool(
  members: RotationMember[],
  configuredIds?: string[],
): string[] {
  const byId = new Map(members.map((m) => [m.user_id, m]));

  if (configuredIds?.length) {
    const configured = configuredIds.filter((id) => byId.has(id));
    if (configured.length > 0) return [...new Set(configured)];
  }

  const eligible = members
    .filter((m) => DEFAULT_ROTATION_ROLES.includes(m.role))
    .map((m) => m.user_id)
    .sort();
  if (eligible.length > 0) return eligible;

  return members.map((m) => m.user_id).sort();
}

/**
 * The agent whose turn it is: the step's `turn`-th assignment goes to
 * `pool[turn % pool.length]`, so consecutive leads walk the pool in order.
 *
 * This replaced a "fewest open conversations" pick, which was fair only
 * on paper. Agents rarely close threads, so open counts are backlog, not
 * workload — and the member with the smallest backlog took every lead
 * until they caught up with the next one. In production one agent with
 * 156 open threads received 40 leads in a row while colleagues sat on
 * 197–792. A turn counter hands out leads strictly in order, whatever
 * anyone's history.
 */
export function agentForTurn(pool: string[], turn: number): string | undefined {
  if (pool.length === 0) return undefined;
  const index = ((Math.trunc(turn) % pool.length) + pool.length) % pool.length;
  return pool[index];
}
