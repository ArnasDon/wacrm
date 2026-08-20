// ============================================================
// PATCH /api/account/members/[userId]/ba-profile
//
// Admin+ edits a teammate's BA fields (region, market, capacity,
// status, languages — §9.1). `profiles_update` RLS (migration 017)
// only lets a user edit their OWN row, so this goes through the
// `set_ba_profile_fields` SECURITY DEFINER RPC (migration 056),
// exactly like `PATCH /api/account/members/[userId]` goes through
// `set_member_role` for role changes.
//
// Any field omitted from the body is left unchanged. `region_id`/
// `market_id` explicitly set to `null` clears that field (a BA who
// no longer covers a market) — distinguished from "omitted" via the
// RPC's p_clear_region/p_clear_market flags.
// ============================================================

import { NextResponse } from 'next/server';
import type { PostgrestError } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const BA_STATUSES = ['active', 'inactive', 'on_leave'] as const;
const LANGUAGES = ['ur', 'ps', 'pa', 'ur-Roman'] as const;

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === '42501')
    return NextResponse.json({ error: err.message }, { status: 403 });
  if (err.code === '22023')
    return NextResponse.json({ error: err.message }, { status: 400 });
  console.error('[ba-profile route] unexpected RPC error:', err);
  return NextResponse.json(
    { error: 'Failed to update BA profile' },
    { status: 500 }
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:baProfile:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;
    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    if (
      body.ba_status !== undefined &&
      !(BA_STATUSES as readonly string[]).includes(body.ba_status)
    ) {
      return NextResponse.json(
        { error: `ba_status must be one of: ${BA_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }
    if (body.capacity !== undefined) {
      const parsed = Number(body.capacity);
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        return NextResponse.json(
          { error: 'capacity must be a non-negative integer' },
          { status: 400 }
        );
      }
    }
    if (body.languages !== undefined) {
      if (
        !Array.isArray(body.languages) ||
        !body.languages.every((l: unknown) =>
          (LANGUAGES as readonly string[]).includes(l as string)
        )
      ) {
        return NextResponse.json(
          { error: `languages must be a subset of: ${LANGUAGES.join(', ')}` },
          { status: 400 }
        );
      }
    }
    if (
      body.region_id !== undefined &&
      body.region_id !== null &&
      typeof body.region_id !== 'string'
    ) {
      return NextResponse.json(
        { error: 'region_id must be a string or null' },
        { status: 400 }
      );
    }
    if (
      body.market_id !== undefined &&
      body.market_id !== null &&
      typeof body.market_id !== 'string'
    ) {
      return NextResponse.json(
        { error: 'market_id must be a string or null' },
        { status: 400 }
      );
    }

    const { error } = await ctx.supabase.rpc('set_ba_profile_fields', {
      p_user_id: userId,
      p_region_id: body.region_id ?? null,
      p_market_id: body.market_id ?? null,
      p_ba_status: body.ba_status ?? null,
      p_capacity: body.capacity !== undefined ? Number(body.capacity) : null,
      p_languages: body.languages ?? null,
      p_clear_region: body.region_id === null,
      p_clear_market: body.market_id === null,
    });

    if (error) return rpcErrorToResponse(error);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
