import { getLocalAccountContext, withAccount } from '@/lib/db/context';
import {
  assertSameOrigin,
  readObject,
  requireUUID,
  RequestError,
  localErrorResponse,
} from '@/lib/api/local-route';
import { hasMinRole } from '@/lib/auth/roles';
import { readFlow } from '@/lib/db/flows';
import { queryRows } from '@/lib/db/rows';
import { validateFlowForActivation } from '@/lib/flows/validate';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(request);
    const ctx = await getLocalAccountContext();
    if (!hasMinRole(ctx.role, 'agent'))
      throw new RequestError('Insufficient permissions.', 403);
    const id = requireUUID((await params).id);
    const body = await readObject(request);
    if (!['draft', 'active', 'archived'].includes(body.status as string))
      throw new RequestError('Invalid flow status.');
    const result = await withAccount(ctx, async (db) => {
      await db.query(
        'SELECT id FROM public.flows WHERE account_id=$1 AND id=$2 FOR UPDATE',
        [ctx.accountId, id]
      );
      const graph = await readFlow(db, ctx.accountId, id);
      if (!graph) throw new RequestError('Flow not found.', 404);
      if (body.status === 'active') {
        const issues = validateFlowForActivation(
          { ...graph.flow, trigger_config: { ...graph.flow.trigger_config } },
          graph.nodes
        );
        if (issues.some((i) => i.severity === 'error')) return { issues };
      }
      const [flow] = await queryRows(
        db,
        'UPDATE public.flows SET status=$3 WHERE account_id=$1 AND id=$2 RETURNING *',
        [ctx.accountId, id, body.status]
      );
      return { flow };
    });
    return 'issues' in result
      ? Response.json(
          {
            error: 'Cannot activate flow � fix the issues below first.',
            issues: result.issues,
          },
          { status: 422 }
        )
      : Response.json(result);
  } catch (error) {
    return localErrorResponse(error);
  }
}
