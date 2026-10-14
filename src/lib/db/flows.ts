import type { SqlConnection } from './transaction';
import type { LocalAccountContext } from './context-core';
import type { FlowRow } from '@/lib/flows/types';
import { queryRows } from './rows';
import { FlowStore } from './flow-store';
import { getFlowTemplate } from '@/lib/flows/templates';
import { RequestError } from '@/lib/api/local-route';
export interface FlowNodeInput {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
  position_x?: number;
  position_y?: number;
}
export interface FlowInput {
  name?: string;
  description?: string | null;
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config?: Record<string, unknown>;
  entry_node_id?: string | null;
  fallback_policy?: Record<string, unknown>;
  nodes?: FlowNodeInput[];
  template_slug?: string;
}
export function parseFlowInput(body: Record<string, unknown>): FlowInput {
  const out: FlowInput = {};
  for (const key of [
    'name',
    'description',
    'entry_node_id',
    'template_slug',
  ] as const)
    if (key in body) {
      if (
        typeof body[key] !== 'string' &&
        !(body[key] === null && ['description', 'entry_node_id'].includes(key))
      )
        throw new RequestError(`Invalid ${key}.`);
      Object.assign(out, { [key]: body[key] });
    }
  if (out.name !== undefined) {
    out.name = out.name.trim();
    if (!out.name || out.name.length > 200)
      throw new RequestError('A name of up to 200 characters is required.');
  }
  if ('trigger_type' in body) {
    if (
      !['keyword', 'first_inbound_message', 'manual'].includes(
        body.trigger_type as string
      )
    )
      throw new RequestError('Invalid trigger type.');
    out.trigger_type = body.trigger_type as FlowInput['trigger_type'];
  }
  for (const key of ['trigger_config', 'fallback_policy'] as const)
    if (key in body) {
      if (
        !body[key] ||
        typeof body[key] !== 'object' ||
        Array.isArray(body[key])
      )
        throw new RequestError(`Invalid ${key}.`);
      out[key] = body[key] as Record<string, unknown>;
    }
  if ('nodes' in body) {
    if (!Array.isArray(body.nodes) || body.nodes.length > 500)
      throw new RequestError('Invalid flow nodes.');
    const keys = new Set<string>();
    out.nodes = body.nodes.map((node) => {
      if (
        !node ||
        typeof node !== 'object' ||
        typeof node.node_key !== 'string' ||
        !node.node_key ||
        node.node_key.length > 200 ||
        keys.has(node.node_key) ||
        typeof node.node_type !== 'string' ||
        !node.config ||
        typeof node.config !== 'object' ||
        Array.isArray(node.config)
      )
        throw new RequestError('Invalid or duplicate flow node.');
      keys.add(node.node_key);
      for (const key of ['position_x', 'position_y'])
        if (
          node[key] !== undefined &&
          (typeof node[key] !== 'number' || !Number.isFinite(node[key]))
        )
          throw new RequestError('Invalid node position.');
      return {
        node_key: node.node_key,
        node_type: node.node_type,
        config: node.config,
        position_x: node.position_x ?? 0,
        position_y: node.position_y ?? 0,
      };
    });
  }
  return out;
}
export function listFlows(db: SqlConnection, accountId: string) {
  return queryRows<FlowRow>(
    db,
    'SELECT * FROM public.flows WHERE account_id=$1 ORDER BY created_at DESC,id DESC',
    [accountId]
  );
}
export async function readFlow(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  const store = new FlowStore(db, accountId);
  const flow = await store.flow(id);
  return flow ? { flow, nodes: await store.nodes(id) } : null;
}
async function replaceNodes(
  db: SqlConnection,
  accountId: string,
  id: string,
  nodes: FlowNodeInput[]
) {
  await db.query(
    'DELETE FROM public.flow_nodes n USING public.flows f WHERE n.flow_id=f.id AND f.account_id=$1 AND f.id=$2',
    [accountId, id]
  );
  for (const node of nodes)
    await db.query(
      'INSERT INTO public.flow_nodes(flow_id,node_key,node_type,config,position_x,position_y) SELECT id,$3,$4,$5::jsonb,$6,$7 FROM public.flows WHERE account_id=$1 AND id=$2',
      [
        accountId,
        id,
        node.node_key,
        node.node_type,
        JSON.stringify(node.config),
        node.position_x ?? 0,
        node.position_y ?? 0,
      ]
    );
}
export async function createFlow(
  db: SqlConnection,
  ctx: LocalAccountContext,
  raw: FlowInput
) {
  let input = raw;
  if (raw.template_slug) {
    const template = getFlowTemplate(raw.template_slug);
    if (!template) throw new RequestError('Unknown flow template.');
    input = {
      ...template,
      trigger_config: { ...template.trigger_config },
      name: raw.name || template.name,
      nodes: template.nodes.map((node) => ({
        ...node,
        config: { ...node.config },
      })),
    };
  }
  if (!input.name?.trim()) throw new RequestError('Flow name is required.');
  const [flow] = await queryRows<FlowRow>(
    db,
    "INSERT INTO public.flows(account_id,user_id,name,description,status,trigger_type,trigger_config,entry_node_id) VALUES($1,$2,$3,$4,'draft',$5,$6::jsonb,$7) RETURNING *",
    [
      ctx.accountId,
      ctx.userId,
      input.name.trim(),
      input.description ?? null,
      input.trigger_type ?? 'manual',
      JSON.stringify(input.trigger_config ?? {}),
      input.entry_node_id ?? null,
    ]
  );
  if (input.nodes) await replaceNodes(db, ctx.accountId, flow.id, input.nodes);
  return flow;
}
export async function updateFlow(
  db: SqlConnection,
  accountId: string,
  id: string,
  input: FlowInput
) {
  const [flow] = await queryRows<FlowRow>(
    db,
    'SELECT * FROM public.flows WHERE account_id=$1 AND id=$2 FOR UPDATE',
    [accountId, id]
  );
  if (!flow) return null;
  const fields = [
    'name',
    'description',
    'trigger_type',
    'trigger_config',
    'entry_node_id',
    'fallback_policy',
  ] as const;
  const changed = fields.filter((key) => Object.hasOwn(input, key));
  if (changed.length)
    await db.query(
      `UPDATE public.flows SET ${changed.map((key, i) => `${key}=$${i + 3}${['trigger_config', 'fallback_policy'].includes(key) ? '::jsonb' : ''}`).join(',')} WHERE account_id=$1 AND id=$2`,
      [
        accountId,
        id,
        ...changed.map((key) =>
          ['trigger_config', 'fallback_policy'].includes(key)
            ? JSON.stringify(input[key])
            : input[key]
        ),
      ]
    );
  if (input.nodes) await replaceNodes(db, accountId, id, input.nodes);
  return readFlow(db, accountId, id);
}
export async function deleteFlow(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  return (
    (
      await queryRows(
        db,
        'DELETE FROM public.flows WHERE account_id=$1 AND id=$2 RETURNING id',
        [accountId, id]
      )
    ).length > 0
  );
}
export async function flowRuns(
  db: SqlConnection,
  accountId: string,
  id: string
) {
  const graph = await readFlow(db, accountId, id);
  if (!graph) return null;
  const runs = await queryRows<{ id: string }>(
    db,
    `SELECT r.id,r.status,r.current_node_key,r.started_at,r.last_advanced_at,r.ended_at,r.end_reason,r.vars,r.reprompt_count,jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone) AS contact FROM public.flow_runs r LEFT JOIN public.contacts c ON c.id=r.contact_id AND c.account_id=$1 WHERE r.account_id=$1 AND r.flow_id=$2 ORDER BY r.started_at DESC LIMIT 50`,
    [accountId, id]
  );
  const events = await queryRows(
    db,
    'SELECT e.flow_run_id,e.event_type,e.node_key,e.payload,e.created_at FROM public.flow_run_events e JOIN public.flow_runs r ON r.id=e.flow_run_id WHERE r.account_id=$1 AND e.flow_run_id=ANY($2::uuid[]) ORDER BY e.created_at',
    [accountId, runs.map((run) => run.id)]
  );
  return { flow: { id: graph.flow.id, name: graph.flow.name }, runs, events };
}
