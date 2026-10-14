import { accountRoute, requireUUID } from '@/lib/api/local-route';
import { queryRows } from '@/lib/db/rows';
import type { Deal } from '@/types';

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const rows = await queryRows<{ deal: Deal }>(
      db,
      `SELECT to_jsonb(d) || jsonb_build_object('stage',to_jsonb(s)) AS deal
      FROM public.deals d LEFT JOIN public.pipeline_stages s ON s.id=d.stage_id
      WHERE d.account_id=$1 AND d.contact_id=$2 ORDER BY d.created_at DESC,d.id DESC`,
      [ctx.accountId, requireUUID((await params).id)]
    );
    return { deals: rows.map((row) => row.deal) };
  });
}
