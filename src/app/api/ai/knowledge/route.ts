import { aiRoute } from '@/lib/ai/local-route';
import { readObject, RequestError, requireUUID } from '@/lib/api/local-route';
import { AiStore } from '@/lib/db/ai-store';
import { indexDocument } from '@/lib/ai/index-document';
export function GET(request: Request) {
  return aiRoute(request, 'viewer', async (ctx) => ({
    documents: (await new AiStore(ctx.db, ctx.accountId).documents()).map(
      ({ id, title, updated_at }) => ({ id, title, updated_at })
    ),
  }));
}
export function POST(request: Request) {
  return aiRoute(request, 'admin', async (ctx) => {
    const body = await readObject(request);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!title || !content)
      throw new RequestError('Title and content are required.');
    if (content.length > 1000000)
      throw new RequestError('Document is too large.');
    const doc = await ctx.run((db) =>
      new AiStore(db, ctx.accountId).createDocument(ctx.userId, title, content)
    );
    return indexDocument(ctx, doc.id, content);
  });
}
