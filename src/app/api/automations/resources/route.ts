import { accountRoute } from '@/lib/api/local-route';
import { queryRows } from '@/lib/db/rows';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    pipelines: await queryRows(
      db,
      'SELECT id,name FROM public.pipelines WHERE account_id=$1 ORDER BY name',
      [ctx.accountId]
    ),
    stages: await queryRows(
      db,
      'SELECT s.id,s.name,s.pipeline_id,s.position FROM public.pipeline_stages s JOIN public.pipelines p ON p.id=s.pipeline_id WHERE p.account_id=$1 ORDER BY s.position',
      [ctx.accountId]
    ),
  }));
}
