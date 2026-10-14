import { aiRoute } from '@/lib/ai/local-route';
import { readObject, RequestError, requireUUID } from '@/lib/api/local-route';
import { AiStore } from '@/lib/db/ai-store';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { validateAiCredentials } from '@/lib/ai/validate';
import { embedTexts } from '@/lib/ai/embeddings';
export function GET(request: Request) {
  return aiRoute(request, 'viewer', (ctx) =>
    new AiStore(ctx.db, ctx.accountId).safeConfig()
  );
}
export function DELETE(request: Request) {
  return aiRoute(request, 'admin', async (ctx) => {
    await ctx.run((db) => new AiStore(db, ctx.accountId).deleteConfig());
    return { success: true };
  });
}
export function POST(request: Request) {
  return aiRoute(request, 'admin', async (ctx) => {
    const body = await readObject(request);
    const provider = body.provider;
    if (provider !== 'openai' && provider !== 'anthropic')
      throw new RequestError('Invalid provider.');
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) throw new RequestError('Model is required.');
    const existing = await new AiStore(ctx.db, ctx.accountId).config();
    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    let key = rawKey;
    if (!key && existing?.api_key) {
      try {
        key = decrypt(existing.api_key);
      } catch {
        throw new RequestError(
          'Stored API key could not be decrypted. Re-enter your key.'
        );
      }
    }
    if (!key) throw new RequestError('API key is required.');
    const max = Number(body.auto_reply_max_per_conversation);
    const maxPer = Number.isFinite(max)
      ? Math.min(20, Math.max(1, Math.floor(max)))
      : 3;
    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null;
    const handoff =
      'handoff_agent_id' in body
        ? body.handoff_agent_id
          ? requireUUID(body.handoff_agent_id)
          : null
        : (existing?.handoff_agent_id ?? null);
    if (handoff && !(await new AiStore(ctx.db, ctx.accountId).member(handoff)))
      throw new RequestError('Handoff agent must belong to this account.');
    if (
      !existing ||
      rawKey ||
      provider !== existing.provider ||
      model !== existing.model
    )
      await validateAiCredentials({
        provider,
        model,
        apiKey: key,
        systemPrompt,
        isActive: body.is_active === true,
        autoReplyEnabled: body.auto_reply_enabled === true,
        autoReplyMaxPerConversation: maxPer,
        handoffAgentId: handoff,
        embeddingsApiKey: null,
      });
    const embedding =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : '';
    if (embedding) await embedTexts(embedding, ['ping']);
    const input: Record<string, unknown> = {
      provider,
      model,
      system_prompt: systemPrompt,
      is_active: body.is_active === true,
      auto_reply_enabled: body.auto_reply_enabled === true,
      auto_reply_max_per_conversation: maxPer,
      handoff_agent_id: handoff,
    };
    if (rawKey) input.api_key = encrypt(rawKey);
    if (embedding) input.embeddings_api_key = encrypt(embedding);
    else if (body.embeddings_api_key === null) input.embeddings_api_key = null;
    await ctx.run((db) =>
      new AiStore(db, ctx.accountId).saveConfig(ctx.userId, input)
    );
    return { success: true };
  });
}
