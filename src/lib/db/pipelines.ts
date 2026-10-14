import type { Pipeline, PipelineStage } from '@/types';
import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { resolveAccount } from './context-core';
import { RecordNotFoundError } from './errors';

const defaults = [
  ['New Lead', '#3b82f6'],
  ['Qualified', '#eab308'],
  ['Proposal Sent', '#f97316'],
  ['Negotiation', '#8b5cf6'],
  ['Won', '#22c55e'],
];
export function listPipelines(db: SqlConnection, accountId: string) {
  return queryRows<Pipeline>(
    db,
    'SELECT * FROM public.pipelines WHERE account_id=$1 ORDER BY created_at,id',
    [accountId]
  );
}
export function listStages(
  db: SqlConnection,
  accountId: string,
  pipelineId: string
) {
  return queryRows<PipelineStage>(
    db,
    'SELECT s.* FROM public.pipeline_stages s JOIN public.pipelines p ON p.id=s.pipeline_id WHERE p.account_id=$1 AND p.id=$2 ORDER BY s.position,s.id',
    [accountId, pipelineId]
  );
}
async function assertPipeline(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  if (
    !(
      await queryRows(
        db,
        'SELECT id FROM public.pipelines WHERE account_id=$1 AND id=$2 FOR UPDATE',
        [accountId, id]
      )
    ).length
  )
    throw new RecordNotFoundError('Pipeline not found.');
}
export async function createPipeline(
  db: SqlConnection,
  userId: string,
  name: string,
  seedOnly = false
) {
  const ctx = await resolveAccount(db, userId);
  // Serialize empty-account seeding across tabs and development StrictMode.
  await db.query('SELECT id FROM public.accounts WHERE id=$1 FOR UPDATE', [
    ctx.accountId,
  ]);
  if (seedOnly) {
    const [existing] = await listPipelines(db, ctx.accountId);
    if (existing) return existing;
  }
  const [pipeline] = await queryRows<Pipeline>(
    db,
    'INSERT INTO public.pipelines(user_id,account_id,name) VALUES ($1,$2,$3) RETURNING *',
    [userId, ctx.accountId, name]
  );
  for (const [position, [stageName, color]] of defaults.entries()) {
    await db.query(
      'INSERT INTO public.pipeline_stages(pipeline_id,name,color,position) VALUES ($1,$2,$3,$4)',
      [pipeline.id, stageName, color, position]
    );
  }
  return pipeline;
}
export async function savePipeline(
  db: SqlConnection,
  accountId: string,
  id: string,
  name: string,
  stages: Pick<PipelineStage, 'id' | 'name' | 'color'>[]
) {
  await assertPipeline(db, accountId, id);
  const current = new Set(
    (await listStages(db, accountId, id)).map((stage) => stage.id)
  );
  if (
    stages.length !== current.size ||
    new Set(stages.map((stage) => stage.id)).size !== current.size ||
    stages.some((stage) => !current.has(stage.id))
  )
    throw new RecordNotFoundError('Pipeline stage not found.');
  await db.query(
    'UPDATE public.pipelines SET name=$1 WHERE id=$2 AND account_id=$3',
    [name, id, accountId]
  );
  for (const [position, stage] of stages.entries()) {
    await db.query(
      'UPDATE public.pipeline_stages SET name=$1,color=$2,position=$3 WHERE id=$4 AND pipeline_id=$5',
      [stage.name, stage.color, position, stage.id, id]
    );
  }
}
export async function addStage(
  db: SqlConnection,
  accountId: string,
  pipelineId: string,
  name: string,
  color: string
) {
  await assertPipeline(db, accountId, pipelineId);
  const [stage] = await queryRows<PipelineStage>(
    db,
    'INSERT INTO public.pipeline_stages(pipeline_id,name,color,position) SELECT $1,$2,$3,COALESCE(MAX(position),-1)+1 FROM public.pipeline_stages WHERE pipeline_id=$1 RETURNING *',
    [pipelineId, name, color]
  );
  return stage;
}
export async function deleteStage(
  db: SqlConnection,
  accountId: string,
  pipelineId: string,
  id: string
) {
  await assertPipeline(db, accountId, pipelineId);
  return (
    (
      await queryRows(
        db,
        'DELETE FROM public.pipeline_stages WHERE pipeline_id=$1 AND id=$2 RETURNING id',
        [pipelineId, id]
      )
    ).length > 0
  );
}
export async function deletePipeline(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  return (
    (
      await queryRows(
        db,
        'DELETE FROM public.pipelines WHERE account_id=$1 AND id=$2 RETURNING id',
        [accountId, id]
      )
    ).length > 0
  );
}
