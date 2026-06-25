// ============================================================
// /api/ai/knowledge
//
//   GET  — list this account's knowledge_base_entries.
//   POST — create a manual entry (title, content).
//
// These are the *dashboard* endpoints for managing the AI
// assistant's knowledge base (spec §10), so they authenticate the
// normal way (cookie session) and go through the RLS client. Both
// methods are admin+ only: the KB is account-settings-class data
// (spec §4.2 RLS: all ops for `is_account_member(account_id,
// 'admin')`), so we enforce the same admin floor on the wire that
// the table's RLS policies enforce in the database.
//
// `token_estimate` is computed server-side from the content via the
// shared chars/4 heuristic (`estimateTokens`, spec §4.2 / §9) so the
// Settings size meter has a consistent value regardless of caller.
// `source_type` is fixed to 'manual' here; file-sourced entries come
// in through the dedicated upload route.
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
// silently truncate.
const MAX_CONTENT_LEN = 200_000;

// Columns safe to expose. Mirrors the `KnowledgeBaseEntry` shape.
const SAFE_COLUMNS =
  'id, account_id, title, content, source_type, source_filename, enabled, token_estimate, created_by_user_id, created_at, updated_at';

export async function GET() {
  try {
    const ctx = await requireRole('admin');
    // Defence in depth: the capability predicate is the single source
    // of truth for "can edit account settings" (the KB is settings-
    // class), alongside the role floor above and the table RLS policy.
    if (!canEditSettings(ctx.role)) {
      throw new ForbiddenError('This action requires the admin role or higher');
    }

    const { data, error } = await ctx.supabase
      .from('knowledge_base_entries')
      .select(SAFE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/ai/knowledge] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load knowledge base entries' },
        { status: 500 }
      );
    }

    return NextResponse.json({ entries: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    if (!canEditSettings(ctx.role)) {
      throw new ForbiddenError('This action requires the admin role or higher');
    }

    const limit = checkRateLimit(
      `admin:knowledgeCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      title?: unknown;
      content?: unknown;
    } | null;

    const rawTitle = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!rawTitle) {
      return NextResponse.json(
        { error: "'title' is required" },
        { status: 400 }
      );
    }
    if (rawTitle.length > MAX_TITLE_LEN) {
      return NextResponse.json(
        { error: `Title must be ${MAX_TITLE_LEN} characters or fewer` },
        { status: 400 }
      );
    }

    const rawContent =
      typeof body?.content === 'string' ? body.content.trim() : '';
    if (!rawContent) {
      return NextResponse.json(
        { error: "'content' is required" },
        { status: 400 }
      );
    }
    if (rawContent.length > MAX_CONTENT_LEN) {
      return NextResponse.json(
        { error: `Content must be ${MAX_CONTENT_LEN} characters or fewer` },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('knowledge_base_entries')
      .insert({
        account_id: ctx.accountId,
        title: rawTitle,
        content: rawContent,
        source_type: 'manual',
        token_estimate: estimateTokens(rawContent),
        created_by_user_id: ctx.userId,
      })
      .select(SAFE_COLUMNS)
      .single();

    if (error || !data) {
      console.error('[POST /api/ai/knowledge] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create knowledge base entry' },
        { status: 500 }
      );
    }

    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
