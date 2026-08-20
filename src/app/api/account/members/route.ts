// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { canManageMembers, isAccountRole } from '@/lib/auth/roles';
import type { AccountMember } from '@/types';

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
  region_id: string | null;
  market_id: string | null;
  ba_status: 'active' | 'inactive' | 'on_leave';
  open_leads: number;
  capacity: number;
  languages: string[];
  region: { name: string } | { name: string }[] | null;
  market: { name: string } | { name: string }[] | null;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // RLS on profiles allows reading any row whose account matches
    // the caller's, so this query is naturally account-scoped.
    // region/market are embedded by name (migration 049/051, §12) so
    // the BA routing UI doesn't need a second round trip per member.
    const { data, error } = await ctx.supabase
      .from('profiles')
      .select(
        'user_id, full_name, email, avatar_url, account_role, created_at, ' +
          'region_id, market_id, ba_status, open_leads, capacity, languages, ' +
          'region:regions(name), market:markets(name)'
      )
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[GET /api/account/members] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load members' },
        { status: 500 }
      );
    }

    const canSeeEmails = canManageMembers(ctx.role);
    const oneName = (v: ProfileRow['region']) =>
      (Array.isArray(v) ? v[0]?.name : v?.name) ?? null;

    const members: AccountMember[] = (data as unknown as ProfileRow[]).flatMap(
      (row) => {
        // Defensive: the DB enum should never let an unknown role
        // through, but if a migration ever broadens the enum without
        // updating TS, skip the row rather than crash the page.
        if (!isAccountRole(row.account_role)) return [];
        return [
          {
            user_id: row.user_id,
            full_name: row.full_name ?? '',
            email: canSeeEmails ? row.email : null,
            avatar_url: row.avatar_url,
            role: row.account_role,
            joined_at: row.created_at,
            ba: {
              region_id: row.region_id,
              region_name: oneName(row.region),
              market_id: row.market_id,
              market_name: oneName(row.market),
              ba_status: row.ba_status,
              open_leads: row.open_leads,
              capacity: row.capacity,
              languages: row.languages ?? [],
            },
          },
        ];
      }
    );

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
