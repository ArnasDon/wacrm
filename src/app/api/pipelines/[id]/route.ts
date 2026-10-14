import {
  accountRoute,
  readObject,
  RequestError,
  requireUUID,
} from '@/lib/api/local-route';
import {
  listStages,
  savePipeline,
  addStage,
  deleteStage,
  deletePipeline,
} from '@/lib/db/pipelines';
type Context = { params: Promise<{ id: string }> };
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100)
    throw new RequestError('Invalid name.');
  return value.trim();
}
function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))
    throw new RequestError('Invalid color.');
  return value;
}
export function GET(request: Request, context: Context) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    stages: await listStages(
      db,
      ctx.accountId,
      requireUUID((await context.params).id)
    ),
  }));
}
export function PATCH(request: Request, context: Context) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    const body = await readObject(request);
    if (!Array.isArray(body.stages) || body.stages.length > 100)
      throw new RequestError('Invalid stages.');
    const stages = body.stages.map((stage) => {
      if (!stage || typeof stage !== 'object')
        throw new RequestError('Invalid stage.');
      return {
        id: requireUUID(stage.id),
        name: name(stage.name),
        color: color(stage.color),
      };
    });
    await savePipeline(
      db,
      ctx.accountId,
      requireUUID((await context.params).id),
      name(body.name),
      stages
    );
    return { ok: true };
  });
}
export function POST(request: Request, context: Context) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    const body = await readObject(request);
    return {
      stage: await addStage(
        db,
        ctx.accountId,
        requireUUID((await context.params).id),
        name(body.name),
        color(body.color)
      ),
    };
  });
}
export function DELETE(request: Request, context: Context) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    const body = await readObject(request);
    const id = requireUUID((await context.params).id);
    const deleted = body.stageId
      ? await deleteStage(db, ctx.accountId, id, requireUUID(body.stageId))
      : await deletePipeline(db, ctx.accountId, id);
    if (!deleted) throw new RequestError('Record not found.', 404);
    return { ok: true };
  });
}
