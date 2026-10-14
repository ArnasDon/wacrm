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
    const body = await readObject(request);
    if (!Array.isArray(body.messages))
      throw new RequestError('Messages are required.');
    const messages = body.messages
      .filter(
        (m): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          !!m.content.trim()
      )
      .slice(-20);
    if (!messages.length)
      throw new RequestError('Send a message to test the agent.');
    const config = await loadAiConfig(ctx.db, ctx.accountId, {
      requireActive: false,
    });
    if (!config) throw new RequestError('Configure the AI assistant first.');
    const knowledge = await retrieveKnowledge(
      ctx.db,
      ctx.accountId,
      config,
      latestUserMessage(messages)
    );
    const { text, handoff } = await generateReply({
      config,
      messages,
      systemPrompt: buildSystemPrompt({
        userPrompt: config.systemPrompt,
        mode: 'auto_reply',
        knowledge,
      }),
    });
    return { reply: text, handoff };
  });
}
