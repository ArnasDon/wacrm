// ============================================================
// GET /api/v1/templates — list WhatsApp message templates
// (scope: templates:read).
//
// Keyset-paginated, newest first. Optional filters: `?status=`
// (Meta's raw status enum, e.g. APPROVED/PENDING/REJECTED — see
// src/lib/whatsapp/template-status-normalize.ts) and `?category=`
// (Marketing/Utility/Authentication). Use this to discover a
// template's approved `name`/`language`/variables before calling
// `POST /api/v1/messages` with `type: "template"`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { TEMPLATE_SELECT, serializeTemplate } from '@/lib/api/v1/templates';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'templates:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const category = url.searchParams.get('category');

    let query = ctx.supabase
      .from('message_templates')
      .select(TEMPLATE_SELECT)
      .eq('account_id', ctx.accountId);

    if (status) query = query.eq('status', status.toUpperCase());
    if (category) query = query.eq('category', category);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/templates] list error:', error);
      return fail('internal', 'Failed to list templates', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeTemplate(r as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
