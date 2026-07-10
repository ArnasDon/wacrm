// ============================================================
// /api/account
//
//   GET   — current caller's account + role. Any member.
//   PATCH — rename the account.                  Admin+.
//
// Why both verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from 'next/server';

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      logo_url?: unknown;
    } | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 }
      );
    }

    // Update only the fields supplied — the Branding tab may save the
    // name, the logo, or both.
    const updates: { name?: string; logo_url?: string | null } = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string') {
        return NextResponse.json(
          { error: "'name' must be a string" },
          { status: 400 }
        );
      }
      const name = body.name.trim();
      if (name.length === 0) {
        return NextResponse.json(
          { error: 'Account name cannot be empty' },
          { status: 400 }
        );
      }
      if (name.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
          { status: 400 }
        );
      }
      updates.name = name;
    }

    if (body.logo_url !== undefined) {
      if (body.logo_url === null) {
        updates.logo_url = null;
      } else if (typeof body.logo_url === 'string') {
        const url = body.logo_url.trim();
        if (url.length === 0) {
          updates.logo_url = null;
        } else if (url.length > 2000) {
          return NextResponse.json(
            { error: "'logo_url' is too long" },
            { status: 400 }
          );
        } else {
          // http(s) only — reject javascript:/data: so a stored logo
          // can never become an injection vector where it's rendered.
          let parsed: URL;
          try {
            parsed = new URL(url);
          } catch {
            return NextResponse.json(
              { error: "'logo_url' must be a valid URL" },
              { status: 400 }
            );
          }
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return NextResponse.json(
              { error: "'logo_url' must be an http(s) URL" },
              { status: 400 }
            );
          }
          updates.logo_url = url;
        }
      } else {
        return NextResponse.json(
          { error: "'logo_url' must be a string or null" },
          { status: 400 }
        );
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // RLS allows this UPDATE because accounts_update requires
    // `is_account_member(id, 'admin')`, and requireRole already
    // guaranteed the caller is admin+.
    const { data, error } = await ctx.supabase
      .from('accounts')
      .update(updates)
      .eq('id', ctx.accountId)
      .select('id, name, logo_url')
      .single();

    if (error) {
      console.error('[PATCH /api/account] update error:', error);
      return NextResponse.json(
        { error: 'Failed to update account' },
        { status: 500 }
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
