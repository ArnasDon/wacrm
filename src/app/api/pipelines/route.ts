import { accountRoute, readObject, RequestError } from '@/lib/api/local-route';
import { listPipelines, createPipeline } from '@/lib/db/pipelines';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    pipelines: await listPipelines(db, ctx.accountId),
  }));
}
export function POST(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    const body = await readObject(request);
    if (
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      body.name.length > 100
    )
      throw new RequestError('Invalid pipeline name.');
    return {
      pipeline: await createPipeline(
        db,
        ctx.userId,
        body.name.trim(),
        body.seedOnly === true
      ),
    };
  });
}
