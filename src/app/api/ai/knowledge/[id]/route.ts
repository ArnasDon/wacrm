import { aiRoute } from '@/lib/ai/local-route';
import { readObject, RequestError, requireUUID } from '@/lib/api/local-route';
import { AiStore } from '@/lib/db/ai-store';
import { indexDocument } from '@/lib/ai/index-document';
type Params = { params: Promise<{ id: string }> };
export function GET(request: Request, { params }: Params) {
  return aiRoute(request, 'viewer', async (ctx) => {
    const doc = await new AiStore(ctx.db, ctx.accountId).document(
      requireUUID((await params).id)
    );
    if (!doc) throw new RequestError('Document not found.', 404);
    return doc;
  });
}
export function DELETE(request: Request, { params }: Params) {
  return aiRoute(request, 'admin', async (ctx) => {
    await ctx.run(async (db) =>
      new AiStore(db, ctx.accountId).deleteDocument(
        requireUUID((await params).id)
      )
    );
    return { success: true };
  });
}
export function PATCH(request: Request, { params }: Params) {
  return aiRoute(request, 'admin', async (ctx) => {
    const id = requireUUID((await params).id);
    const body = await readObject(request);
    const input: { title?: string; content?: string } = {};
    for (const key of ['title', 'content'] as const)
      if (key in body) {
        if (typeof body[key] !== 'string' || !body[key].trim())
          throw new RequestError(key + ' cannot be empty.');
        input[key] = body[key].trim();
      }
    if (!Object.keys(input).length)
      throw new RequestError('Nothing to update.');
    if ((input.content?.length ?? 0) > 1000000)
      throw new RequestError('Document is too large.');
    const doc = await ctx.run((db) =>
      new AiStore(db, ctx.accountId).updateDocument(id, input)
    );
    return input.content !== undefined
      ? indexDocument(ctx, id, doc.content)
      : { success: true };
  });
}
