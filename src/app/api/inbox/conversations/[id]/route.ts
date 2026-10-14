import type { Conversation } from '@/types';
import {
  accountRoute,
  readObject,
  RequestError,
  requireUUID,
} from '@/lib/api/local-route';
import { getConversation, updateConversation } from '@/lib/db/inbox';
type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, context: Context) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const conversation = await getConversation(
      db,
      ctx.accountId,
      requireUUID((await context.params).id)
    );
    if (!conversation) throw new RequestError('Conversation not found.', 404);
    return { conversation };
  });
}
export function PATCH(request: Request, context: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    const body = await readObject(request);
    const input: Partial<
      Pick<Conversation, 'status' | 'assigned_agent_id' | 'unread_count'>
    > = {};
    if (Object.hasOwn(body, 'status')) {
      if (!['open', 'pending', 'closed'].includes(String(body.status)))
        throw new RequestError('Invalid conversation status.');
      input.status = body.status as Conversation['status'];
    }
    if (Object.hasOwn(body, 'assigned_agent_id'))
      input.assigned_agent_id =
        body.assigned_agent_id === null
          ? undefined
          : requireUUID(body.assigned_agent_id);
    if (Object.hasOwn(body, 'unread_count')) {
      if (body.unread_count !== 0)
        throw new RequestError(
          'Only marking a conversation read is supported.'
        );
      input.unread_count = 0;
    }
    return {
      conversation: await updateConversation(
        db,
        ctx.accountId,
        requireUUID((await context.params).id),
        input
      ),
    };
  });
}
