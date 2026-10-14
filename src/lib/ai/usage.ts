import type { SqlConnection } from '@/lib/db/transaction';
import type { AiProvider, AiUsage } from './types';

export interface LogAiUsageArgs {
  accountId: string;
  /** Null for a draft not tied to one thread, or when the row was
   *  deleted between generation and logging. */
  conversationId: string | null;
  mode: 'auto_reply' | 'draft';
  provider: AiProvider;
  model: string;
  /** Provider usage; a no-op when null (nothing worth recording). */
  usage: AiUsage | null;
}

/**
 * Best-effort append to `ai_usage_log` — one row per LLM call, for cost
 * visibility on the account's BYO key. NEVER throws: usage accounting
 * must not fail a reply the customer is waiting on, so any DB error is
 * logged and swallowed. Skips entirely when the provider didn't report
 * usage (we'd only be writing zeros).
 *
 * Pass the service-role admin client from the webhook, or the RLS-scoped
 * SSR client from a route — writes land either way (there's no
 * `authenticated` INSERT policy, so an SSR write relies on the service
 * role; callers that must persist from a route should pass the admin
 * client).
 */
export async function logAiUsage(
  db: SqlConnection,
  args: LogAiUsageArgs
): Promise<void> {
  if (!args.usage) return;
  try {
    await db.query(
      `INSERT INTO public.ai_usage_log(account_id,conversation_id,mode,provider,model,prompt_tokens,completion_tokens,total_tokens)
      VALUES($1,(SELECT id FROM public.conversations WHERE account_id=$1 AND id=$2),$3,$4,$5,$6,$7,$8)`,
      [
        args.accountId,
        args.conversationId,
        args.mode,
        args.provider,
        args.model,
        args.usage.promptTokens,
        args.usage.completionTokens,
        args.usage.totalTokens,
      ]
    );
  } catch (err) {
    console.error('[ai usage] log insert threw:', err);
  }
}
