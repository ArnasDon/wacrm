import { aiRoute } from '@/lib/ai/local-route';
import { readObject, RequestError, requireUUID } from '@/lib/api/local-route';
import { AiStore } from '@/lib/db/ai-store';
import { loadAiConfig } from '@/lib/ai/config';
import { buildConversationContext } from '@/lib/ai/context';
import { retrieveKnowledge } from '@/lib/ai/knowledge';
import { generateReply } from '@/lib/ai/generate';
import { buildSystemPrompt } from '@/lib/ai/defaults';
import { latestUserMessage } from '@/lib/ai/query';
import { logAiUsage } from '@/lib/ai/usage';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import type { ChatMessage } from '@/lib/ai/types';
export function POST(request: Request) {
  return aiRoute(request, 'agent', async (ctx) => {
    if (
      !checkRateLimit(
        'ai-draft-acct:' + ctx.accountId,
        RATE_LIMITS.aiDraftAccount
      ).success
    )
      throw new RequestError('Account AI rate limit reached.', 429);
    const body = await readObject(request);
    const id = requireUUID(body.conversation_id);
    if (!(await new AiStore(ctx.db, ctx.accountId).conversation(id)))
      throw new RequestError('Conversation not found.', 404);
    const config = await loadAiConfig(ctx.db, ctx.accountId);
    if (!config)
      throw new RequestError('Enable the AI assistant in Settings first.');
    const messages = await buildConversationContext(ctx.db, ctx.accountId, id);
    if (!messages.length)
      throw new RequestError('No messages to draft from yet.');
    const knowledge = await retrieveKnowledge(
      ctx.db,
      ctx.accountId,
      config,
      latestUserMessage(messages)
    );
    const { text, usage } = await generateReply({
      config,
      messages,
      systemPrompt: buildSystemPrompt({
        userPrompt: config.systemPrompt,
        mode: 'draft',
        knowledge,
      }),
    });
    await logAiUsage(ctx.db, {
      accountId: ctx.accountId,
      conversationId: id,
      mode: 'draft',
      provider: config.provider,
      model: config.model,
      usage,
    });
    return { draft: text };
  });
}
