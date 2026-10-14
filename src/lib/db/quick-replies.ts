import type { SqlConnection } from './transaction';
import type { LocalAccountContext } from './context-core';
import type { QuickReply } from '@/types';
import { queryRows } from './rows';
import { RequestError } from '@/lib/api/local-route';
import { validateInteractivePayload } from '@/lib/whatsapp/interactive';
function validate(input: Record<string, unknown>) {
  if (typeof input.title !== 'string' || !input.title.trim())
    throw new RequestError('Title is required.');
  const title = input.title.trim();
  const kind = input.kind ?? 'text';
  if (kind === 'interactive') {
    const result = validateInteractivePayload(input.interactive_payload);
    if (!result.ok) throw new RequestError(result.error);
    return {
      title,
      kind,
      content_text: null,
      interactive_payload: input.interactive_payload,
    };
  }
  if (kind !== 'text') throw new RequestError('Invalid quick reply kind.');
  if (typeof input.content_text !== 'string' || !input.content_text.trim())
    throw new RequestError('Text is required.');
  return {
    title,
    kind,
    content_text: input.content_text,
    interactive_payload: null,
  };
}
export function listQuickReplies(db: SqlConnection, accountId: string) {
  return queryRows<QuickReply>(
    db,
    'SELECT * FROM public.quick_replies WHERE account_id=$1 ORDER BY created_at DESC,id DESC',
    [accountId]
  );
}
export async function createQuickReply(
  db: SqlConnection,
  ctx: LocalAccountContext,
  input: Record<string, unknown>
) {
  const row = validate(input);
  const [created] = await queryRows<QuickReply>(
    db,
    'INSERT INTO public.quick_replies(account_id,user_id,title,kind,content_text,interactive_payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING *',
    [
      ctx.accountId,
      ctx.userId,
      row.title,
      row.kind,
      row.content_text,
      JSON.stringify(row.interactive_payload),
    ]
  );
  return created;
}
export async function updateQuickReply(
  db: SqlConnection,
  accountId: string,
  id: string,
  input: Record<string, unknown>
) {
  const [existing] = await queryRows<QuickReply>(
    db,
    'SELECT * FROM public.quick_replies WHERE account_id=$1 AND id=$2 FOR UPDATE',
    [accountId, id]
  );
  if (!existing) throw new RequestError('Quick reply not found.', 404);
  const row = validate({
    ...existing,
    ...Object.fromEntries(
      Object.entries(input).filter(([key]) =>
        ['title', 'kind', 'content_text', 'interactive_payload'].includes(key)
      )
    ),
  });
  await db.query(
    'UPDATE public.quick_replies SET title=$3,kind=$4,content_text=$5,interactive_payload=$6::jsonb WHERE account_id=$1 AND id=$2',
    [
      accountId,
      id,
      row.title,
      row.kind,
      row.content_text,
      JSON.stringify(row.interactive_payload),
    ]
  );
}
export async function deleteQuickReply(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  await db.query(
    'DELETE FROM public.quick_replies WHERE account_id=$1 AND id=$2',
    [accountId, id]
  );
}
