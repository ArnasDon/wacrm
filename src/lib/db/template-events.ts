import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';
export interface TemplateEvent {
  field: string;
  wabaId?: string;
  value: unknown;
}
/** Called within a worker transaction after verifying Meta's signature. */
export async function applyTemplateEvent(
  db: SqlConnection,
  event: TemplateEvent
) {
  if (!event.wabaId || !event.value || typeof event.value !== 'object') return;
  if (
    ![
      'message_template_status_update',
      'message_template_quality_update',
    ].includes(event.field)
  )
    return;
  const value = event.value as Record<string, unknown>;
  if (
    typeof value.message_template_id !== 'string' &&
    typeof value.message_template_id !== 'number'
  )
    return;
  const metaId = String(value.message_template_id);
  const configs = await queryRows<{ account_id: string; user_id: string }>(
    db,
    'SELECT account_id,user_id FROM public.whatsapp_config WHERE waba_id=$1',
    [event.wabaId]
  );
  if (configs.length !== 1) {
    console.warn('[template-webhook] WABA has no unique local configuration');
    return;
  }
  const config = configs[0];
  const name =
    typeof value.message_template_name === 'string'
      ? value.message_template_name
      : null;
  const language =
    typeof value.message_template_language === 'string'
      ? value.message_template_language
      : 'en_US';
  const statusEvent = event.field === 'message_template_status_update';
  if (statusEvent && typeof value.event !== 'string') return;
  const status = statusEvent ? normalizeStatus(value.event as string) : null;
  const rawScore =
    typeof value.new_quality_score === 'string'
      ? value.new_quality_score.toUpperCase()
      : '';
  const score = ['GREEN', 'YELLOW', 'RED'].includes(rawScore) ? rawScore : null;
  const rejection =
    status === 'REJECTED'
      ? typeof value.reason === 'string'
        ? value.reason
        : 'Rejected by Meta'
      : null;
  // Match submit/sync's account/name/language lock when the event contains the name.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    name
      ? `${config.account_id}:${name}:${language}`
      : `template-meta:${config.account_id}:${metaId}`,
  ]);
  let rows = await queryRows<{ id: string }>(
    db,
    'SELECT id FROM public.message_templates WHERE account_id=$1 AND meta_template_id=$2',
    [config.account_id, metaId]
  );
  if (!rows.length && name) {
    rows = await queryRows<{ id: string }>(
      db,
      'SELECT id FROM public.message_templates WHERE account_id=$1 AND name=$2 AND language=$3 ORDER BY created_at LIMIT 1',
      [config.account_id, name, language]
    );
    if (!rows.length)
      rows = await queryRows<{ id: string }>(
        db,
        "INSERT INTO public.message_templates(account_id,user_id,name,language,body_text,meta_template_id) VALUES($1,$2,$3,$4,'',$5) RETURNING id",
        [config.account_id, config.user_id, name, language, metaId]
      );
  }
  for (const row of rows) {
    if (statusEvent)
      await db.query(
        'UPDATE public.message_templates SET meta_template_id=$3,status=$4,rejection_reason=$5,submission_error=NULL WHERE account_id=$1 AND id=$2',
        [config.account_id, row.id, metaId, status, rejection]
      );
    else
      await db.query(
        'UPDATE public.message_templates SET meta_template_id=$3,quality_score=$4 WHERE account_id=$1 AND id=$2',
        [config.account_id, row.id, metaId, score]
      );
  }
}
