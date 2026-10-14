import type { Deal } from '@/types';
import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { resolveAccount } from './context-core';
import { RecordNotFoundError } from './errors';
export type DealInput = Partial<
  Pick<
    Deal,
    | 'title'
    | 'value'
    | 'currency'
    | 'pipeline_id'
    | 'stage_id'
    | 'contact_id'
    | 'assigned_to'
    | 'notes'
    | 'expected_close_date'
    | 'status'
  >
>;
export function listDeals(
  db: SqlConnection,
  accountId: string,
  pipelineId: string
) {
  return queryRows<{ deal: Deal }>(
    db,
    `SELECT to_jsonb(d) || jsonb_build_object('contact', to_jsonb(c), 'assignee',
    CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'full_name',p.full_name,'avatar_url',p.avatar_url) END) AS deal
    FROM public.deals d LEFT JOIN public.contacts c ON c.id=d.contact_id AND c.account_id=d.account_id
    LEFT JOIN public.profiles p ON p.id=d.assigned_to AND p.account_id=d.account_id
    WHERE d.account_id=$1 AND d.pipeline_id=$2 ORDER BY d.created_at DESC,d.id`,
    [accountId, pipelineId]
  ).then((rows) => rows.map((row) => row.deal));
}
export async function saveDeal(
  db: SqlConnection,
  userId: string,
  id: string | null,
  input: DealInput
): Promise<Deal> {
  const ctx = await resolveAccount(db, userId);
  let previous: Deal | undefined;
  if (id) {
    [previous] = await queryRows<Deal>(
      db,
      'SELECT * FROM public.deals WHERE account_id=$1 AND id=$2 FOR UPDATE',
      [ctx.accountId, id]
    );
    if (!previous) throw new RecordNotFoundError('Deal not found.');
  }
  const fields = [
    'title',
    'value',
    'currency',
    'pipeline_id',
    'stage_id',
    'contact_id',
    'assigned_to',
    'notes',
    'expected_close_date',
    'status',
  ] as const;
  const value = {
    title: '',
    value: 0,
    currency: ctx.account.default_currency ?? 'USD',
    status: 'open',
    ...previous,
    ...input,
  };
  if (!value.title || !value.pipeline_id || !value.stage_id)
    throw Object.assign(new Error('Required deal fields missing.'), {
      code: '22023',
    });
  const valid = await queryRows(
    db,
    `SELECT s.id FROM public.pipeline_stages s JOIN public.pipelines p ON p.id=s.pipeline_id
    WHERE p.account_id=$1 AND p.id=$2 AND s.id=$3
    AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM public.contacts c WHERE c.account_id=$1 AND c.id=$4))
    AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM public.profiles m WHERE m.account_id=$1 AND m.id=$5))`,
    [
      ctx.accountId,
      value.pipeline_id,
      value.stage_id,
      value.contact_id ?? null,
      value.assigned_to ?? null,
    ]
  );
  if (!valid.length)
    throw new RecordNotFoundError('Related deal record not found.');
  const values = fields.map((field) => value[field] ?? null);
  const [deal] = id
    ? await queryRows<Deal>(
        db,
        `UPDATE public.deals SET ${fields.map((field, i) => `${field}=$${i + 3}`).join(',')},updated_at=now() WHERE account_id=$1 AND id=$2 RETURNING *`,
        [ctx.accountId, id, ...values]
      )
    : await queryRows<Deal>(
        db,
        `INSERT INTO public.deals(user_id,account_id,${fields.join(',')}) VALUES ($1,$2,${fields.map((_, i) => `$${i + 3}`).join(',')}) RETURNING *`,
        [userId, ctx.accountId, ...values]
      );
  return { ...deal, value: Number(deal.value) };
}
export async function deleteDeal(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  return (
    (
      await queryRows(
        db,
        'DELETE FROM public.deals WHERE account_id=$1 AND id=$2 RETURNING id',
        [accountId, id]
      )
    ).length > 0
  );
}
