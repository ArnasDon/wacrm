import { aiRoute } from '@/lib/ai/local-route';
import { readObject, RequestError, requireUUID } from '@/lib/api/local-route';
import { AiStore } from '@/lib/db/ai-store';
type Params = { params: Promise<{ conversationId: string }> };
export function POST(request: Request, { params }: Params) {
  return aiRoute(request, 'agent', async (ctx) => {
    const body = await readObject(request);
    if (typeof body.paused !== 'boolean')
      throw new RequestError('Paused must be a boolean.');
    const id = requireUUID((await params).conversationId);
    await ctx.run((db) =>
      new AiStore(db, ctx.accountId).toggle(
        id,
        ctx.userId,
        body.paused as boolean,
        body.assign_to_me === true
      )
    );
    return { success: true, paused: body.paused };
  });
}
