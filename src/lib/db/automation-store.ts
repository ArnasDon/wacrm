import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import type {
  Automation,
  AutomationStep,
  AutomationLogStepResult,
} from '@/types';
import type { AutomationContext } from '@/lib/automations/engine';
export class AutomationStore {
  constructor(
    readonly db: SqlConnection,
    readonly accountId: string
  ) {}
  async ownedContact(id: string) {
    return (
      (
        await queryRows<{ id: string }>(
          this.db,
          'SELECT id FROM public.contacts WHERE account_id=$1 AND id=$2',
          [this.accountId, id]
        )
      )[0] ?? null
    );
  }
  async matching(trigger: string) {
    return queryRows<Automation>(
      this.db,
      'SELECT * FROM public.automations WHERE account_id=$1 AND trigger_type=$2 AND is_active=true ORDER BY created_at,id',
      [this.accountId, trigger]
    );
  }
  async automation(id: string) {
    return (
      (
        await queryRows<Automation>(
          this.db,
          'SELECT * FROM public.automations WHERE account_id=$1 AND id=$2',
          [this.accountId, id]
        )
      )[0] ?? null
    );
  }
  async log(id: string, contactId: string | null, trigger: string) {
    const [row] = await queryRows<{ id: string }>(
      this.db,
      `INSERT INTO public.automation_logs(automation_id,account_id,user_id,contact_id,trigger_event,steps_executed,status) SELECT id,account_id,user_id,$3,$4,'[]'::jsonb,'failed' FROM public.automations WHERE account_id=$1 AND id=$2 AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM public.contacts WHERE account_id=$1 AND id=$3)) RETURNING id`,
      [this.accountId, id, contactId, trigger]
    );
    return row ?? null;
  }
  async increment(id: string) {
    await this.db.query(
      'UPDATE public.automations SET execution_count=execution_count+1,last_executed_at=now() WHERE account_id=$1 AND id=$2',
      [this.accountId, id]
    );
  }
  async steps(
    id: string,
    start: number,
    parent: string | null,
    branch: string | null
  ) {
    return queryRows<AutomationStep>(
      this.db,
      `SELECT s.* FROM public.automation_steps s JOIN public.automations a ON a.id=s.automation_id WHERE a.account_id=$1 AND a.id=$2 AND s.position >= $3 AND s.parent_step_id IS NOT DISTINCT FROM $4::uuid AND ($4::uuid IS NULL OR s.branch=$5) ORDER BY s.position,s.id`,
      [this.accountId, id, start, parent, branch ?? 'yes']
    );
  }
  async park(input: {
    automationId: string;
    contactId: string | null;
    logId: string | null;
    parentStepId: string | null;
    branch: string | null;
    position: number;
    context: AutomationContext;
    runAt: string;
  }) {
    await this.db.query(
      `INSERT INTO public.automation_pending_executions(automation_id,account_id,user_id,contact_id,log_id,parent_step_id,branch,next_step_position,context,run_at,status) SELECT a.id,a.account_id,a.user_id,$3,$4,$5,$6,$7,$8::jsonb,$9,'pending' FROM public.automations a WHERE a.account_id=$1 AND a.id=$2 AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM public.contacts WHERE account_id=$1 AND id=$3)) AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM public.automation_logs WHERE account_id=$1 AND automation_id=$2 AND id=$4)) AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM public.automation_steps WHERE automation_id=$2 AND id=$5))`,
      [
        this.accountId,
        input.automationId,
        input.contactId,
        input.logId,
        input.parentStepId,
        input.branch,
        input.position,
        JSON.stringify(input.context),
        input.runAt,
      ]
    );
  }
  async firstAgent() {
    return (
      await queryRows<{ user_id: string }>(
        this.db,
        "SELECT user_id FROM public.profiles WHERE account_id=$1 AND account_role IN ('owner','admin','agent') ORDER BY created_at,user_id LIMIT 1",
        [this.accountId]
      )
    )[0]?.user_id;
  }
  async assign(contactId: string, agentId: string) {
    const rows = await queryRows<{ id: string }>(
      this.db,
      "UPDATE public.conversations SET assigned_agent_id=$3 WHERE account_id=$1 AND contact_id=$2 AND EXISTS(SELECT 1 FROM public.profiles WHERE account_id=$1 AND user_id=$3 AND account_role IN ('owner','admin','agent')) RETURNING id",
      [this.accountId, contactId, agentId]
    );
    if (!rows.length)
      throw new Error('Conversation or agent not found for this account');
  }
  async customField(id: string) {
    return (
      (
        await queryRows<{ id: string }>(
          this.db,
          'SELECT id FROM public.custom_fields WHERE account_id=$1 AND id=$2',
          [this.accountId, id]
        )
      )[0] ?? null
    );
  }
  async customValue(contactId: string, fieldId: string, value: string) {
    await this.db.query(
      'INSERT INTO public.contact_custom_values(contact_id,custom_field_id,value) SELECT c.id,f.id,$4 FROM public.contacts c JOIN public.custom_fields f ON f.account_id=c.account_id WHERE c.account_id=$1 AND c.id=$2 AND f.id=$3 ON CONFLICT(contact_id,custom_field_id) DO UPDATE SET value=EXCLUDED.value',
      [this.accountId, contactId, fieldId, value]
    );
  }
  async updateContact(contactId: string, key: string, value: string) {
    if (!['name', 'email', 'company'].includes(key))
      throw new Error('Unsupported contact field');
    await this.db.query(
      `UPDATE public.contacts SET ${key}=$3 WHERE account_id=$1 AND id=$2`,
      [this.accountId, contactId, value]
    );
  }
  async createDeal(input: {
    userId: string;
    pipelineId: string;
    stageId: string;
    contactId: string | null;
    title: string;
    value: number;
  }) {
    const rows = await queryRows<{ id: string }>(
      this.db,
      `INSERT INTO public.deals(account_id,user_id,pipeline_id,stage_id,contact_id,title,value,currency,status) SELECT a.id,$2,p.id,s.id,$5,$6,$7,COALESCE(a.default_currency,'USD'),'open' FROM public.accounts a JOIN public.pipelines p ON p.account_id=a.id JOIN public.pipeline_stages s ON s.pipeline_id=p.id WHERE a.id=$1 AND p.id=$3 AND s.id=$4 AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM public.contacts WHERE account_id=$1 AND id=$5)) RETURNING id`,
      [
        this.accountId,
        input.userId,
        input.pipelineId,
        input.stageId,
        input.contactId,
        input.title,
        input.value,
      ]
    );
    if (!rows.length)
      throw new Error('Deal references do not belong to this account');
  }
  async close(contactId: string) {
    await this.db.query(
      "UPDATE public.conversations SET status='closed' WHERE account_id=$1 AND contact_id=$2",
      [this.accountId, contactId]
    );
  }
  async conversation(contactId: string, id?: string) {
    return (
      (
        await queryRows<{ id: string }>(
          this.db,
          'SELECT id FROM public.conversations WHERE account_id=$1 AND contact_id=$2 AND ($3::uuid IS NULL OR id=$3) ORDER BY created_at,id LIMIT 1',
          [this.accountId, contactId, id ?? null]
        )
      )[0]?.id ?? null
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
  async contactField(contactId: string, key: string) {
    if (!['name', 'email', 'company', 'phone'].includes(key)) return null;
    return (
      (
        await queryRows<{ value: string | null }>(
          this.db,
          'SELECT to_jsonb(c)->>$3 AS value FROM public.contacts c WHERE account_id=$1 AND id=$2',
          [this.accountId, contactId, key]
        )
      )[0]?.value ?? null
    );
  }
  async append(
    id: string,
    items: AutomationLogStepResult[],
    status: string | null,
    error: string | null
  ) {
    await this.db.query(
      "UPDATE public.automation_logs SET steps_executed=COALESCE(steps_executed,'[]'::jsonb)||$3::jsonb,status=COALESCE($4,status),error_message=COALESCE($5,error_message) WHERE account_id=$1 AND id=$2",
      [this.accountId, id, JSON.stringify(items), status, error]
    );
  }
  async finalize(id: string, status: string, error: string | null) {
    await this.db.query(
      'UPDATE public.automation_logs SET status=$3,error_message=$4 WHERE account_id=$1 AND id=$2',
      [this.accountId, id, status, error]
    );
  }
  async pending(id: string, status: 'done' | 'failed') {
    await this.db.query(
      'UPDATE public.automation_pending_executions SET status=$3 WHERE account_id=$1 AND id=$2',
      [this.accountId, id, status]
    );
  }
}
