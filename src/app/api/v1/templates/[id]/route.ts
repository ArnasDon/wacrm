// ============================================================
// GET /api/v1/templates/{id} — read one message template
// (scope: templates:read). Account-scoped: a foreign id → 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { TEMPLATE_SELECT, serializeTemplate } from '@/lib/api/v1/templates';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'templates:read');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('message_templates')
      .select(TEMPLATE_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/templates] read error:', error);
      return fail('internal', 'Failed to read template', 500);
    }
    if (!data) return fail('not_found', 'Template not found', 404);

    return ok(serializeTemplate(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
