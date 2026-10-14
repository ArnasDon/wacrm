import { randomUUID } from 'node:crypto';
import { getLocalAccountContext, withAccount } from '@/lib/db/context';
import { queryRows } from '@/lib/db/rows';
import { hasMinRole } from '@/lib/auth/roles';
import {
  assertSameOrigin,
  localErrorResponse,
  RequestError,
} from '@/lib/api/local-route';
import { readWhatsAppConfig } from '@/lib/db/whatsapp-config';
import { decrypt } from '@/lib/whatsapp/encryption';
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api';
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { ensureMediaHeaderHandle } from '@/lib/whatsapp/template-header-handle';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';

const dryRun = () =>
  ['true', '1'].includes(process.env.WHATSAPP_TEMPLATES_DRY_RUN ?? '');

async function saveTemplate(
  ctx: Awaited<ReturnType<typeof getLocalAccountContext>>,
  payload: TemplatePayload,
  values: { status: string; metaId: string | null; error: string | null }
) {
  return withAccount(ctx, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${ctx.accountId}:${payload.name}:${payload.language}`,
    ]);
    const existing = await queryRows<{ id: string }>(
      db,
      'SELECT id FROM public.message_templates WHERE account_id=$1 AND name=$2 AND language=$3 LIMIT 1 FOR UPDATE',
      [ctx.accountId, payload.name, payload.language]
    );
    const fields = [
      payload.category,
      payload.header_type ?? null,
      payload.header_content ?? null,
      payload.header_media_url ?? null,
      payload.header_handle ?? null,
      payload.body_text,
      payload.footer_text ?? null,
      payload.buttons ? JSON.stringify(payload.buttons) : null,
      payload.sample_values ? JSON.stringify(payload.sample_values) : null,
      values.status,
      values.metaId,
      values.error,
      ctx.userId,
    ];
    if (existing[0]) {
      const [row] = await queryRows(
        db,
        `UPDATE public.message_templates SET category=$1,header_type=$2,header_content=$3,header_media_url=$4,header_handle=$5,body_text=$6,footer_text=$7,buttons=$8::jsonb,sample_values=$9::jsonb,status=$10,meta_template_id=$11,submission_error=$12,rejection_reason=NULL,last_submitted_at=now(),user_id=$13,updated_at=now() WHERE id=$14 AND account_id=$15 RETURNING *`,
        [...fields, existing[0].id, ctx.accountId]
      );
      return row;
    }
    const [row] = await queryRows(
      db,
      `INSERT INTO public.message_templates(account_id,user_id,name,category,language,header_type,header_content,header_media_url,header_handle,body_text,footer_text,buttons,sample_values,status,meta_template_id,submission_error,last_submitted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,now()) RETURNING *`,
      [
        ctx.accountId,
        ctx.userId,
        payload.name,
        payload.category,
        payload.language,
        payload.header_type ?? null,
        payload.header_content ?? null,
        payload.header_media_url ?? null,
        payload.header_handle ?? null,
        payload.body_text,
        payload.footer_text ?? null,
        payload.buttons ? JSON.stringify(payload.buttons) : null,
        payload.sample_values ? JSON.stringify(payload.sample_values) : null,
        values.status,
        values.metaId,
        values.error,
      ]
    );
    return row;
  });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ctx = await getLocalAccountContext();
    if (!hasMinRole(ctx.role, 'admin'))
      throw new RequestError('Insufficient permissions.', 403);
    const payload = (await request
      .json()
      .catch(() => null)) as TemplatePayload | null;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new RequestError('Invalid JSON body.');
    if (payload.category === 'Authentication')
      throw new RequestError(
        'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use Sync from Meta.'
      );
    try {
      validateTemplatePayload(payload);
    } catch (error) {
      throw new RequestError(
        error instanceof Error ? error.message : 'Validation failed.'
      );
    }

    let metaTemplateId: string;
    let metaStatus: string;
    if (dryRun()) {
      metaTemplateId = `dry-run-${randomUUID()}`;
      metaStatus = 'PENDING';
    } else {
      const config = await withAccount(ctx, (db) =>
        readWhatsAppConfig(db, ctx.accountId)
      );
      if (!config)
        throw new RequestError(
          'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.'
        );
      if (!config.waba_id)
        throw new RequestError(
          'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.'
        );
      const accessToken = decrypt(config.access_token);
      await ensureMediaHeaderHandle(payload, accessToken);
      try {
        const submitted = await submitMessageTemplate({
          wabaId: config.waba_id,
          accessToken,
          payload: buildMetaTemplatePayload(payload),
        });
        metaTemplateId = submitted.id;
        metaStatus = submitted.status;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Meta submit failed.';
        await saveTemplate(ctx, payload, {
          status: 'DRAFT',
          metaId: null,
          error: message,
        });
        const limited = /\b429\b/.test(message);
        return Response.json(
          {
            error: limited
              ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
              : message,
          },
          { status: limited ? 429 : 502 }
        );
      }
    }
    const template = await saveTemplate(ctx, payload, {
      status: normalizeStatus(metaStatus),
      metaId: metaTemplateId,
      error: null,
    });
    return Response.json({ success: true, template, dry_run: dryRun() });
  } catch (error) {
    return localErrorResponse(error);
  }
}
