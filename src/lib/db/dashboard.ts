import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import type { MetricsBundle } from '@/lib/dashboard/types';
export async function dashboardMetrics(
  db: SqlConnection,
  accountId: string,
  today: string,
  yesterday: string
): Promise<MetricsBundle> {
  const [conv] = await queryRows<{
    active: number;
    today: number;
    yesterday: number;
  }>(
    db,
    `SELECT count(*) FILTER(WHERE status='open')::int AS active,
    count(*) FILTER(WHERE status='open' AND created_at >= $2)::int AS today,
    count(*) FILTER(WHERE status='open' AND created_at >= $3 AND created_at < $2)::int AS yesterday
    FROM public.conversations WHERE account_id=$1`,
    [accountId, today, yesterday]
  );
  const [contacts] = await queryRows<{ today: number; yesterday: number }>(
    db,
    `SELECT count(*) FILTER(WHERE created_at >= $2)::int AS today,
    count(*) FILTER(WHERE created_at >= $3 AND created_at < $2)::int AS yesterday FROM public.contacts WHERE account_id=$1`,
    [accountId, today, yesterday]
  );
  const [deals] = await queryRows<{ count: number; value: string }>(
    db,
    "SELECT count(*)::int AS count,COALESCE(sum(value),0)::text AS value FROM public.deals WHERE account_id=$1 AND status='open'",
    [accountId]
  );
  const [messages] = await queryRows<{ today: number; yesterday: number }>(
    db,
    `SELECT count(*) FILTER(WHERE m.created_at >= $2)::int AS today,
    count(*) FILTER(WHERE m.created_at >= $3 AND m.created_at < $2)::int AS yesterday FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
    WHERE c.account_id=$1 AND m.sender_type='agent'`,
    [accountId, today, yesterday]
  );
  return {
    activeConversations: {
      current: conv.active,
      previous: conv.today - conv.yesterday,
    },
    newContactsToday: { current: contacts.today, previous: contacts.yesterday },
    openDealsValue: Number(deals.value),
    openDealsCount: deals.count,
    messagesSentToday: {
      current: messages.today,
      previous: messages.yesterday,
    },
  };
}
export async function dashboardMessages(
  db: SqlConnection,
  accountId: string,
  start: string
) {
  return queryRows<{
    created_at: string;
    sender_type: string;
    conversation_id: string;
  }>(
    db,
    `SELECT m.created_at,m.sender_type,m.conversation_id FROM public.messages m
    JOIN public.conversations c ON c.id=m.conversation_id WHERE c.account_id=$1 AND m.created_at >= $2 ORDER BY m.conversation_id,m.created_at,m.id`,
    [accountId, start]
  );
}
export async function dashboardPipeline(db: SqlConnection, accountId: string) {
  return {
    stages: await queryRows(
      db,
      'SELECT s.id,s.name,s.color,s.position FROM public.pipeline_stages s JOIN public.pipelines p ON p.id=s.pipeline_id WHERE p.account_id=$1 ORDER BY s.position,s.id',
      [accountId]
    ),
    deals: await queryRows(
      db,
      "SELECT stage_id,value::float8 AS value,status FROM public.deals WHERE account_id=$1 AND status='open'",
      [accountId]
    ),
  };
}
export async function dashboardActivity(db: SqlConnection, accountId: string) {
  return {
    msgs: {
      data: await queryRows(
        db,
        `SELECT m.id,m.content_text,m.created_at,m.conversation_id,
      jsonb_build_object('contact_id',c.contact_id,'contacts',jsonb_build_object('name',ct.name,'phone',ct.phone)) AS conversations
      FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
      LEFT JOIN public.contacts ct ON ct.id=c.contact_id AND ct.account_id=c.account_id
      WHERE c.account_id=$1 AND m.sender_type='customer' ORDER BY m.created_at DESC,m.id LIMIT 10`,
        [accountId]
      ),
    },
    contacts: {
      data: await queryRows(
        db,
        'SELECT id,name,phone,created_at FROM public.contacts WHERE account_id=$1 ORDER BY created_at DESC,id LIMIT 10',
        [accountId]
      ),
    },
    deals: {
      data: await queryRows(
        db,
        `SELECT d.id,d.title,d.updated_at,jsonb_build_object('name',s.name) AS stage FROM public.deals d
      JOIN public.pipeline_stages s ON s.id=d.stage_id AND s.pipeline_id=d.pipeline_id WHERE d.account_id=$1 ORDER BY d.updated_at DESC,d.id LIMIT 10`,
        [accountId]
      ),
    },
    broadcasts: {
      data: await queryRows(
        db,
        'SELECT id,name,status,total_recipients,created_at FROM public.broadcasts WHERE account_id=$1 ORDER BY created_at DESC,id LIMIT 5',
        [accountId]
      ),
    },
    autoLogs: {
      data: await queryRows(
        db,
        `SELECT l.id,l.trigger_event,l.status,l.created_at,jsonb_build_object('name',a.name) AS automation,
      jsonb_build_object('name',c.name,'phone',c.phone) AS contact FROM public.automation_logs l
      JOIN public.automations a ON a.id=l.automation_id LEFT JOIN public.contacts c ON c.id=l.contact_id AND c.account_id=a.account_id
      WHERE a.account_id=$1 ORDER BY l.created_at DESC,l.id LIMIT 10`,
        [accountId]
      ),
    },
  };
}
