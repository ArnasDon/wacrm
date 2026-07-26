import type { AccountMember } from '@/types';

/**
 * Fetch the current account's members from the API (which applies the
 * email-visibility rules — agents/viewers don't see emails). Best-effort:
 * returns `[]` on any error or on an older deployment without the
 * endpoint, so callers can fall back to a queue-only / raw-id picker.
 *
 * Client-side only (uses `fetch` against the relative API route).
 */
export async function fetchAccountMembers(): Promise<AccountMember[]> {
  try {
    const res = await fetch('/api/account/members', { cache: 'no-store' });
    if (!res.ok) return [];
    const json = (await res.json()) as { members?: AccountMember[] };
    return json.members ?? [];
  } catch {
    return [];
  }
}

/** Display label for a member: full name → email → raw id. */
export function memberLabel(m: AccountMember): string {
  return m.full_name || m.email || m.user_id;
}
