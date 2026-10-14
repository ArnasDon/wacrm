import { accountRoute, RequestError } from '@/lib/api/local-route';
import { queryRows } from '@/lib/db/rows';
import type { MessageTemplate } from '@/types';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const status = new URL(request.url).searchParams.get('status');
    if (
      status &&
      ![
        'DRAFT',
        'PENDING',
        'APPROVED',
        'REJECTED',
        'PAUSED',
        'DISABLED',
        'IN_APPEAL',
        'PENDING_DELETION',
      ].includes(status)
    )
      throw new RequestError('Invalid template status.');
    const rows = await queryRows<{ template: MessageTemplate }>(
      db,
      'SELECT to_jsonb(t) AS template FROM public.message_templates t WHERE account_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC,id',
      [ctx.accountId, status]
    );
    return { templates: rows.map((row) => row.template) };
  });
}
