import { aiRoute } from '@/lib/ai/local-route';
import { readObject, RequestError, requireUUID } from '@/lib/api/local-route';
import { AiStore } from '@/lib/db/ai-store';
import { decrypt } from '@/lib/whatsapp/encryption';
import { validateAiCredentials } from '@/lib/ai/validate';
export function POST(request: Request) {
  return aiRoute(request, 'admin', async (ctx) => {
    const body = await readObject(request);
    const provider = body.provider;
    if (provider !== 'openai' && provider !== 'anthropic')
      throw new RequestError('Invalid provider.');
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) throw new RequestError('Model is required.');
    const existing = await new AiStore(ctx.db, ctx.accountId).config();
    let key = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    if (!key && existing?.api_key) {
      try {
        key = decrypt(existing.api_key);
      } catch {
        throw new RequestError('Stored API key could not be decrypted.');
      }
    }
    if (!key) throw new RequestError('Enter an API key to test.');
    await validateAiCredentials({
      provider,
      model,
      apiKey: key,
      systemPrompt: null,
      isActive: true,
      autoReplyEnabled: false,
      autoReplyMaxPerConversation: 3,
      handoffAgentId: null,
      embeddingsApiKey: null,
    });
    return { ok: true };
  });
}
