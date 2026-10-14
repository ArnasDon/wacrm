import { randomUUID } from 'node:crypto';
import type { SqlConnection } from './transaction';
import type { LocalAccountContext } from './context-core';
import type { Automation } from '@/types';
import type {
  BuilderStepInput,
  BuilderStepNode,
} from '@/lib/automations/steps-tree';
import { queryRows } from './rows';
import { RequestError } from '@/lib/api/local-route';
import { getTemplate } from '@/lib/automations/templates';
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate';
export interface AutomationInput {
  name?: string;
  description?: string | null;
  trigger_type?: string;
  trigger_config?: Record<string, unknown>;
  is_active?: boolean;
  steps?: BuilderStepInput[];
  template?: string;
}
export function parseAutomationInput(
  body: Record<string, unknown>
): AutomationInput {
  const result: AutomationInput = {};
  for (const key of [
    'name',
    'description',
    'trigger_type',
    'template',
  ] as const)
    if (key in body) {
      if (
        typeof body[key] !== 'string' &&
        !(key === 'description' && body[key] === null)
      )
        throw new RequestError(`Invalid ${key}.`);
      Object.assign(result, { [key]: body[key] });
    }
  if (result.name !== undefined) {
    result.name = result.name.trim();
    if (!result.name || result.name.length > 200)
      throw new RequestError('A name of up to 200 characters is required.');
  }
  if ('trigger_config' in body) {
    if (
      !body.trigger_config ||
      typeof body.trigger_config !== 'object' ||
      Array.isArray(body.trigger_config)
    )
      throw new RequestError('Invalid trigger configuration.');
    result.trigger_config = body.trigger_config as Record<string, unknown>;
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean')
      throw new RequestError('Invalid activation flag.');
    result.is_active = body.is_active;
  }
  if ('steps' in body) {
    if (!Array.isArray(body.steps) || body.steps.length > 500)
      throw new RequestError('Invalid automation steps.');
    result.steps = body.steps;
  }
  return result;
}
export function listAutomations(db: SqlConnection, accountId: string) {
  return queryRows<Automation>(
    db,
    'SELECT * FROM public.automations WHERE account_id=$1 ORDER BY created_at DESC,id DESC',
    [accountId]
  );
}
async function loadTree(db: SqlConnection, accountId: string, id: string) {
  const rows = await queryRows<{
    id: string;
    parent_step_id: string | null;
    branch: 'yes' | 'no' | null;
    step_type: string;
    step_config: Record<string, unknown>;
  }>(
    db,
    'SELECT s.* FROM public.automation_steps s JOIN public.automations a ON a.id=s.automation_id WHERE a.account_id=$1 AND a.id=$2 ORDER BY s.position,s.id',
    [accountId, id]
  );
  const nodes = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        step_type: row.step_type,
        step_config: row.step_config,
        branches: { yes: [], no: [] },
      } as BuilderStepNode,
    ])
  );
  const roots: BuilderStepNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    if (row.parent_step_id)
      nodes.get(row.parent_step_id)?.branches[row.branch ?? 'yes'].push(node);
    else roots.push(node);
  }
  return roots;
}
export async function readAutomation(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  const [automation] = await queryRows<Automation>(
    db,
    'SELECT * FROM public.automations WHERE account_id=$1 AND id=$2',
    [accountId, id]
  );
  return automation
    ? { automation, steps: await loadTree(db, accountId, id) }
    : null;
}
async function saveSteps(
  db: SqlConnection,
  accountId: string,
  id: string,
  input: BuilderStepInput[]
) {
  let total = 0;
  // Seed templates also support parent_index/branch flat input.
  let tree = input;
  if (
    input.some(
      (step) => step.parent_index !== undefined || step.branch !== undefined
    )
  ) {
    const nodes = input.map((step) => ({
      ...step,
      branches: { yes: [], no: [] } as {
        yes: BuilderStepInput[];
        no: BuilderStepInput[];
      },
    }));
    tree = [];
    nodes.forEach((node, index) => {
      const parent = input[index].parent_index;
      if (parent == null) tree.push(node);
      else {
        if (!Number.isInteger(parent) || parent < 0 || parent >= index)
          throw new RequestError('Invalid template branch.');
        nodes[parent].branches[input[index].branch ?? 'yes'].push(node);
      }
    });
  }
  await db.query(
    'DELETE FROM public.automation_steps s USING public.automations a WHERE s.automation_id=a.id AND a.account_id=$1 AND a.id=$2',
    [accountId, id]
  );
  const walk = async (
    steps: BuilderStepInput[],
    parent: string | null,
    branch: 'yes' | 'no' | null,
    depth: number
  ) => {
    if (!Array.isArray(steps) || depth > 20)
      throw new RequestError('Invalid or excessively nested automation steps.');
    for (let position = 0; position < steps.length; position++) {
      if (++total > 500) throw new RequestError('Too many automation steps.');
      const step = steps[position];
      if (
        !step ||
        typeof step.step_type !== 'string' ||
        !step.step_config ||
        typeof step.step_config !== 'object' ||
        Array.isArray(step.step_config)
      )
        throw new RequestError('Invalid automation step.');
      const stepId = randomUUID();
      await db.query(
        'INSERT INTO public.automation_steps(id,automation_id,parent_step_id,branch,step_type,step_config,position) SELECT $3,id,$4,$5,$6,$7::jsonb,$8 FROM public.automations WHERE account_id=$1 AND id=$2',
        [
          accountId,
          id,
          stepId,
          parent,
          branch,
          step.step_type,
          JSON.stringify(step.step_config),
          position,
        ]
      );
      if (step.branches) {
        await walk(step.branches.yes ?? [], stepId, 'yes', depth + 1);
        await walk(step.branches.no ?? [], stepId, 'no', depth + 1);
      }
    }
  };
  await walk(tree, null, null, 0);
}
function validate(input: AutomationInput, steps: BuilderStepInput[]) {
  if (input.is_active) {
    const issues = [
      ...validateTriggerForActivation(
        input.trigger_type ?? '',
        input.trigger_config ?? {}
      ),
      ...validateStepsForActivation(steps),
    ];
    if (issues.length)
      throw new RequestError(
        `Cannot activate automation: ${issues.map((issue) => issue.message).join('; ')}`
      );
  }
}
export async function createAutomation(
  db: SqlConnection,
  ctx: LocalAccountContext,
  raw: AutomationInput
) {
  let input = raw;
  if (raw.template && !raw.steps?.length) {
    const template = getTemplate(raw.template);
    if (!template) throw new RequestError('Unknown automation template.');
    input = {
      ...template,
      trigger_config: { ...template.trigger_config },
      ...raw,
      steps: template.steps as BuilderStepInput[],
    };
  }
  if (!input.name?.trim() || !input.trigger_type)
    throw new RequestError('name and trigger_type are required');
  validate(input, input.steps ?? []);
  const [automation] = await queryRows<Automation>(
    db,
    'INSERT INTO public.automations(account_id,user_id,name,description,trigger_type,trigger_config,is_active) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *',
    [
      ctx.accountId,
      ctx.userId,
      input.name.trim(),
      input.description ?? null,
      input.trigger_type,
      JSON.stringify(input.trigger_config ?? {}),
      input.is_active ?? false,
    ]
  );
  if (input.steps)
    await saveSteps(db, ctx.accountId, automation.id, input.steps);
  return automation;
}
export async function updateAutomation(
  db: SqlConnection,
  accountId: string,
  id: string,
  input: AutomationInput
) {
  const [existing] = await queryRows<Automation>(
    db,
    'SELECT * FROM public.automations WHERE account_id=$1 AND id=$2 FOR UPDATE',
    [accountId, id]
  );
  if (!existing) return false;
  const fields = [
    'name',
    'description',
    'trigger_type',
    'trigger_config',
    'is_active',
  ] as const;
  const changes = fields.filter((key) => Object.hasOwn(input, key));
  const merged = { ...existing, ...input } as AutomationInput;
  if (merged.is_active)
    validate(merged, input.steps ?? (await loadTree(db, accountId, id)));
  if (changes.length)
    await db.query(
      `UPDATE public.automations SET ${changes.map((key, i) => `${key}=$${i + 3}${key === 'trigger_config' ? '::jsonb' : ''}`).join(',')} WHERE account_id=$1 AND id=$2`,
      [
        accountId,
        id,
        ...changes.map((key) =>
          key === 'trigger_config' ? JSON.stringify(input[key]) : input[key]
        ),
      ]
    );
  if (input.steps) await saveSteps(db, accountId, id, input.steps);
  return true;
}
export async function duplicateAutomation(
  db: SqlConnection,
  ctx: LocalAccountContext,
  id: string
) {
  const graph = await readAutomation(db, ctx.accountId, id);
  if (!graph) return null;
  return createAutomation(db, ctx, {
    name: `${graph.automation.name} (Copy)`,
    description: graph.automation.description,
    trigger_type: graph.automation.trigger_type,
    trigger_config: graph.automation.trigger_config as Record<string, unknown>,
    is_active: false,
    steps: graph.steps,
  });
}
export async function deleteAutomation(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  return (
    (
      await queryRows(
        db,
        'DELETE FROM public.automations WHERE account_id=$1 AND id=$2 RETURNING id',
        [accountId, id]
      )
    ).length > 0
  );
}
export async function automationLogs(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  const graph = await readAutomation(db, accountId, id);
  if (!graph) return null;
  const logs = await queryRows(
    db,
    `SELECT l.*,jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone) AS contact FROM public.automation_logs l LEFT JOIN public.contacts c ON c.id=l.contact_id AND c.account_id=$1 WHERE l.account_id=$1 AND l.automation_id=$2 ORDER BY l.created_at DESC LIMIT 100`,
    [accountId, id]
  );
  return { automation: graph.automation, logs };
}
