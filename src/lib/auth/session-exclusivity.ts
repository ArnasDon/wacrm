import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Single-active-session enforcement (migration 067).
//
// A user may sign in from several devices over time, but never have
// two sessions active at once — except Chat Sandía's own team
// (accounts.enforce_single_session = false there), who test from
// many devices routinely.
//
// Two complementary mechanisms, both driven from claimSingleSession()
// at the moment a new session is established:
//
//   1. Real enforcement: `supabase.auth.signOut({ scope: 'others' })`
//      — a Supabase Auth primitive that revokes every OTHER session's
//      refresh token server-side (never the caller's own). The other
//      device's session dies for real the next time it tries to
//      refresh — this holds even if that device is offline right now,
//      has JS disabled, or never receives the broadcast below.
//
//   2. Instant UX: a Realtime broadcast on a per-user channel, so a
//      device that's open and connected *right now* finds out
//      immediately instead of waiting for its next token refresh
//      (tokens are typically valid ~1h) — see AuthProvider's
//      subscription in use-auth.tsx.
// ============================================================

/** Broadcast channel name for one user's session-exclusivity signal.
 *  Shared between the device that just signed in (sender) and every
 *  other device currently open for the same user (listener). */
export function sessionChannelName(userId: string): string {
  return `user-session:${userId}`;
}

const KICKED_EVENT = 'kicked';

/**
 * Call right after a session is newly established (password sign-in,
 * signup, invite redemption) — never on a token refresh of an
 * already-running session, which would otherwise self-sabotage by
 * signing itself out.
 *
 * No-op (and never throws) when the account has opted out via
 * `enforce_single_session = false`, or when either lookup fails —
 * a lookup failure should never block a legitimate sign-in.
 */
export async function claimSingleSession(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!profile?.account_id) return;

    const { data: account } = await supabase
      .from('accounts')
      .select('enforce_single_session')
      .eq('id', profile.account_id)
      .maybeSingle();
    if (account?.enforce_single_session === false) return;

    // Order matters: broadcast first so an open other-device tab reacts
    // immediately, then revoke — reversing this risks the broadcast
    // itself failing to send once this client's own state is mid-
    // transition from the signOut call.
    const channel = supabase.channel(sessionChannelName(userId));
    await channel.subscribe();
    await channel.send({ type: 'broadcast', event: KICKED_EVENT, payload: {} });
    await supabase.removeChannel(channel);

    await supabase.auth.signOut({ scope: 'others' });
  } catch (err) {
    console.error('[session-exclusivity] claimSingleSession failed:', err);
  }
}

export { KICKED_EVENT };
