// ============================================================
// /api/ai/knowledge/[id]
//
//   PATCH  — update a single knowledge_base_entry (title, content,
//            and/or enabled). Recomputes `token_estimate` whenever
//            `content` changes.
//   DELETE — remove a single entry.
//
// These are the *dashboard* endpoints for editing one KB page
// (spec §10), so they authenticate the normal way (cookie session)
// and go through the RLS client. Both methods are admin+ only: the
// KB is account-settings-class data (spec §4.2 RLS: all ops for
// `is_account_member(account_id, 'admin')`), so we enforce the same
// admin floor on the wire that the table's RLS policies enforce in
// the database — `requireRole('admin')` plus the `canEditSettings`
// capability predicate (defence in depth alongside RLS).
//
// Tenancy: every query is scoped by BOTH `id` and `account_id`, so an
// admin can never touch another account's entry by guessing a UUID.
// RLS already enforces this; the explicit `.eq('account_id', …)`
// filter is belt-and-braces and makes the "0 rows → 404" path precise.
//
// `token_estimate` is recomputed server-side from the new content via
// the shared chars/4 heuristic (`estimateTokens`, spec §4.2 / §9), so
// the Settings size meter stays consistent regardless of caller and
// matches the value the collection route's POST writes.
// ============================================================

import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { canEditSettings } from '@/lib/auth/roles';
import { estimateTokens } from '@/lib/ai/knowledge-base';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const MAX_TITLE_LEN = 200;
// Hard ceiling on a single entry's content. A KB page far longer
// than this is almost certainly a misuse (paste a whole site) and
// would blow the prompt budget on its own — reject early rather than
// silently truncate. Mirrors the collection route's POST.
const MAX_CONTENT_LEN = 200_000;

// Columns safe to expose. Mirrors the `KnowledgeBaseEntry` shape and
// the collection route's `SAFE_COLUMNS`.
const SAFE_COLUMNS =
  'id, account_id, title, content, source_type, source_filename, enabled, token_estimate, created_by_user_id, created_at, updated_at';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    // Defence in depth: the capability predicate is the single source
    // of truth for "can edit account settings" (the KB is settings-
    // class), alongside the role floor above and the table RLS policy.
    if (!canEditSettings(ctx.role)) {
      throw new ForbiddenError('This action requires the admin role or higher');
    }

    const limit = checkRateLimit(
      `admin:knowledgeUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      title?: unknown;
      content?: unknown;
      enabled?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Build the patch from only the fields the caller actually sent, so
    // a partial update (e.g. just toggling `enabled`) leaves the rest
    // untouched. Each field is validated as it's added.
    const update: Record<string, unknown> = {};

    if ('title' in body) {
      const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
      if (!rawTitle) {
        return NextResponse.json(
          { error: "'title' must be a non-empty string" },
          { status: 400 }
        );
      }
      if (rawTitle.length > MAX_TITLE_LEN) {
        return NextResponse.json(
          { error: `Title must be ${MAX_TITLE_LEN} characters or fewer` },
          { status: 400 }
        );
      }
      update.title = rawTitle;
    }

    if ('content' in body) {
      const rawContent =
        typeof body.content === 'string' ? body.content.trim() : '';
      if (!rawContent) {
        return NextResponse.json(
          { error: "'content' must be a non-empty string" },
          { status: 400 }
        );
      }
      if (rawContent.length > MAX_CONTENT_LEN) {
        return NextResponse.json(
          { error: `Content must be ${MAX_CONTENT_LEN} characters or fewer` },
          { status: 400 }
        );
      }
      update.content = rawContent;
      // Recompute the cached estimate whenever content changes so the
      // size meter never drifts from the stored text (spec §4.2 / §9).
      update.token_estimate = estimateTokens(rawContent);
    }

    if ('enabled' in body) {
      if (typeof body.enabled !== 'boolean') {
        return NextResponse.json(
          { error: "'enabled' must be a boolean" },
          { status: 400 }
        );
      }
      update.enabled = body.enabled;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        {
          error:
            "Nothing to update — provide at least one of 'title', 'content', or 'enabled'",
        },
        { status: 400 }
      );
    }

    // Scope the update by account_id as well as id so an admin can never
    // edit another account's entry by guessing a UUID. (RLS already
    // enforces this; the explicit filter makes the "0 rows → 404" path
    // precise.)
    const { data, error } = await ctx.supabase
      .from('knowledge_base_entries')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(SAFE_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/ai/knowledge/[id]] update error:', error);
      return NextResponse.json(
        { error: 'Failed to update knowledge base entry' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Knowledge base entry not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ entry: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    if (!canEditSettings(ctx.role)) {
      throw new ForbiddenError('This action requires the admin role or higher');
    }

    const limit = checkRateLimit(
      `admin:knowledgeDelete:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // Account-scoped delete (id + account_id) for the same tenancy
    // reason as the PATCH above. `.select('id').maybeSingle()` lets us
    // tell "deleted" from "no such entry in this account" → 404.
    const { data, error } = await ctx.supabase
      .from('knowledge_base_entries')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[DELETE /api/ai/knowledge/[id]] delete error:', error);
      return NextResponse.json(
        { error: 'Failed to delete knowledge base entry' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Knowledge base entry not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
