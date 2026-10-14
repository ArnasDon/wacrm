import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import type { FlowRow, FlowRunRow, FlowNodeRow } from '@/lib/flows/types';
/** Explicit worker repository. Every operation retains the configuration-derived account. */
export class FlowStore {
  constructor(
    readonly db: SqlConnection,
    readonly accountId: string
  ) {}
  async activeRun(contactId: string) {
    return (
      (
        await queryRows<FlowRunRow>(
          this.db,
          "SELECT * FROM public.flow_runs WHERE account_id=$1 AND contact_id=$2 AND status='active' ORDER BY started_at DESC LIMIT 1",
          [this.accountId, contactId]
        )
      )[0] ?? null
    );
  }
  async flow(id: string) {
    return (
      (
        await queryRows<FlowRow>(
          this.db,
          'SELECT * FROM public.flows WHERE account_id=$1 AND id=$2',
          [this.accountId, id]
        )
      )[0] ?? null
    );
  }
  async activeFlows() {
    return queryRows<FlowRow>(
      this.db,
      "SELECT * FROM public.flows WHERE account_id=$1 AND status='active' ORDER BY created_at,id",
      [this.accountId]
    );
  }
  async nodes(flowId: string) {
    return queryRows<FlowNodeRow>(
      this.db,
      'SELECT n.* FROM public.flow_nodes n JOIN public.flows f ON f.id=n.flow_id WHERE f.account_id=$1 AND f.id=$2',
      [this.accountId, flowId]
    );
  }
  async event(
    runId: string,
    type: string,
    nodeKey: string | null,
    payload: Record<string, unknown>
  ) {
    await this.db.query(
      'INSERT INTO public.flow_run_events(flow_run_id,event_type,node_key,payload) SELECT id,$3,$4,$5::jsonb FROM public.flow_runs WHERE account_id=$1 AND id=$2',
      [this.accountId, runId, type, nodeKey, JSON.stringify(payload)]
    );
  }
  async duplicate(contactId: string, metaId: string) {
    const [row] = await queryRows<{ found: boolean }>(
      this.db,
      "SELECT EXISTS(SELECT 1 FROM public.flow_run_events e JOIN public.flow_runs r ON r.id=e.flow_run_id WHERE r.account_id=$1 AND r.contact_id=$2 AND e.event_type='reply_received' AND e.payload->>'meta_message_id'=$3) AS found",
      [this.accountId, contactId, metaId]
    );
    return row.found;
  }
  async prompt(runId: string, conversationId: string, metaId: string) {
    await this.db.query(
      "UPDATE public.flow_runs r SET last_prompt_message_id=(SELECT m.id FROM public.messages m WHERE m.conversation_id=$3 AND m.message_id=$4 LIMIT 1) WHERE r.account_id=$1 AND r.id=$2 AND r.conversation_id=$3 AND r.status='active'",
      [this.accountId, runId, conversationId, metaId]
    );
  }
  async handoff(conversationId: string, agentId?: string) {
    await this.db.query(
      "UPDATE public.conversations SET status='pending',assigned_agent_id=COALESCE($3,assigned_agent_id) WHERE account_id=$1 AND id=$2 AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.account_id=$1 AND p.user_id=$3 AND p.account_role IN ('owner','admin','agent')))",
      [this.accountId, conversationId, agentId ?? null]
    );
  }
  async tagPresent(contactId: string, tagId: string) {
    const [row] = await queryRows<{ found: boolean }>(
      this.db,
      'SELECT EXISTS(SELECT 1 FROM public.contact_tags ct JOIN public.contacts c ON c.id=ct.contact_id JOIN public.tags t ON t.id=ct.tag_id WHERE c.account_id=$1 AND t.account_id=$1 AND c.id=$2 AND t.id=$3) AS found',
      [this.accountId, contactId, tagId]
    );
    return row.found;
  }
  async contactField(
    contactId: string,
    key: string
  ): Promise<string | undefined> {
    if (!['name', 'email', 'phone', 'company'].includes(key))
      throw new Error('Unsupported contact field');
    const [row] = await queryRows<{ value: string | null }>(
      this.db,
      'SELECT to_jsonb(c)->>$3 AS value FROM public.contacts c WHERE account_id=$1 AND id=$2',
      [this.accountId, contactId, key]
    );
    return row?.value || undefined;
  }
  async end(
    id: string,
    status: 'completed' | 'handed_off' | 'timed_out' | 'failed',
    reason: string
  ) {
    await this.db.query(
      "UPDATE public.flow_runs SET status=$3,ended_at=now(),end_reason=$4 WHERE account_id=$1 AND id=$2 AND status='active'",
      [this.accountId, id, status, reason]
    );
  }
  async advance(id: string, expected: string | null, next: string) {
    const rows = await queryRows<{ id: string }>(
      this.db,
      "UPDATE public.flow_runs SET current_node_key=$4,last_advanced_at=now() WHERE account_id=$1 AND id=$2 AND status='active' AND current_node_key IS NOT DISTINCT FROM $3::text RETURNING id",
      [this.accountId, id, expected, next]
    );
    return rows.length > 0;
  }
  async capture(id: string, vars: Record<string, unknown>) {
    const rows = await queryRows<{ id: string }>(
      this.db,
      "UPDATE public.flow_runs SET vars=$3::jsonb,reprompt_count=0 WHERE account_id=$1 AND id=$2 AND status='active' RETURNING id",
      [this.accountId, id, JSON.stringify(vars)]
    );
    return rows.length > 0;
  }
  async reprompt(id: string, count: number) {
    await this.db.query(
      "UPDATE public.flow_runs SET reprompt_count=$3 WHERE account_id=$1 AND id=$2 AND status='active'",
      [this.accountId, id, count]
    );
  }
  async start(flowId: string, contactId: string, conversationId: string) {
    const [row] = await queryRows<{ run: FlowRunRow }>(
      this.db,
      `WITH inserted AS (
   INSERT INTO public.flow_runs(flow_id,account_id,user_id,contact_id,conversation_id,status,current_node_key)
   SELECT f.id,f.account_id,f.user_id,c.contact_id,c.id,'active',f.entry_node_id FROM public.flows f JOIN public.conversations c ON c.account_id=f.account_id JOIN public.contacts ct ON ct.id=c.contact_id AND ct.account_id=f.account_id
   WHERE f.account_id=$1 AND f.id=$2 AND f.status='active' AND c.contact_id=$3 AND c.id=$4
   ON CONFLICT DO NOTHING RETURNING *
  ), incremented AS (UPDATE public.flows SET execution_count=COALESCE(execution_count,0)+1 WHERE account_id=$1 AND id IN(SELECT flow_id FROM inserted) RETURNING id)
  SELECT to_jsonb(i) AS run FROM inserted i JOIN incremented f ON f.id=i.flow_id`,
      [this.accountId, flowId, contactId, conversationId]
    );
    return row?.run ?? null;
  }
}
