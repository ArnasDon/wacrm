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
import {
  deleteMessageTemplate,
  editMessageTemplate,
} from '@/lib/whatsapp/meta-api';
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { ensureMediaHeaderHandle } from '@/lib/whatsapp/template-header-handle';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDryRun = () =>
  ['true', '1'].includes(process.env.WHATSAPP_TEMPLATES_DRY_RUN ?? '');

export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(request);
    const { id } = await route.params;
    if (!UUID_RE.test(id)) throw new RequestError('Invalid template id.');
    const ctx = await getLocalAccountContext();
    if (!hasMinRole(ctx.role, 'admin'))
      throw new RequestError('Insufficient permissions.', 403);
    const payload = (await request
      .json()
      .catch(() => null)) as TemplatePayload | null;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new RequestError('Invalid JSON body.');
    const [existing] = await withAccount(ctx, (db) =>
      queryRows<{
        id: string;
        name: string;
        status: string;
        meta_template_id: string | null;
      }>(
        db,
        'SELECT id,name,status,meta_template_id FROM public.message_templates WHERE id=$1 AND account_id=$2',
        [id, ctx.accountId]
      )
    );
    if (!existing) throw new RequestError('Template not found.', 404);
    if (!existing.meta_template_id)
      throw new RequestError(
        'This template was never submitted to Meta — use New Template to submit it instead.'
      );
    if (!new Set(['APPROVED', 'REJECTED', 'PAUSED']).has(existing.status))
      throw new RequestError(
        `Templates in status ${existing.status} cannot be edited. Allowed: APPROVED, REJECTED, PAUSED.`
      );
    if (payload.category === 'Authentication')
      throw new RequestError(
        'AUTHENTICATION templates are not editable here — manage them in Meta WhatsApp Manager.'
      );
    try {
      validateTemplatePayload(payload);
    } catch (error) {
      throw new RequestError(
        error instanceof Error ? error.message : 'Validation failed.'
      );
    }

    if (!isDryRun()) {
      const config = await withAccount(ctx, (db) =>
        readWhatsAppConfig(db, ctx.accountId)
      );
      if (!config) throw new RequestError('WhatsApp not configured.');
      const accessToken = decrypt(config.access_token);
      try {
        await ensureMediaHeaderHandle(payload, accessToken);
        await editMessageTemplate({
          metaTemplateId: existing.meta_template_id,
          accessToken,
          components: buildMetaTemplatePayload(payload).components,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Meta edit failed.';
        await withAccount(ctx, (db) =>
          db.query(
            'UPDATE public.message_templates SET submission_error=$1,last_submitted_at=now(),updated_at=now() WHERE id=$2 AND account_id=$3',
            [message, id, ctx.accountId]
          )
        );
        return Response.json({ error: message }, { status: 502 });
      }
    }
    const [template] = await withAccount(ctx, (db) =>
      queryRows(
        db,
        `UPDATE public.message_templates SET category=$1,header_type=$2,header_content=$3,header_media_url=$4,header_handle=$5,body_text=$6,footer_text=$7,buttons=$8::jsonb,sample_values=$9::jsonb,status='PENDING',submission_error=NULL,rejection_reason=NULL,last_submitted_at=now(),updated_at=now() WHERE id=$10 AND account_id=$11 RETURNING *`,
        [
          payload.category,
          payload.header_type ?? null,
          payload.header_content ?? null,
          payload.header_media_url ?? null,
          payload.header_handle ?? null,
          payload.body_text,
          payload.footer_text ?? null,
          payload.buttons ? JSON.stringify(payload.buttons) : null,
          payload.sample_values ? JSON.stringify(payload.sample_values) : null,
          id,
          ctx.accountId,
        ]
      )
    );
    if (!template) throw new RequestError('Template not found.', 404);
    return Response.json({ success: true, template, dry_run: isDryRun() });
  } catch (error) {
    return localErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  route: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(request);
    const { id } = await route.params;
    if (!UUID_RE.test(id)) throw new RequestError('Invalid template id.');
    const ctx = await getLocalAccountContext();
    if (!hasMinRole(ctx.role, 'admin'))
      throw new RequestError('Insufficient permissions.', 403);
    const [existing] = await withAccount(ctx, (db) =>
      queryRows<{ id: string; name: string; meta_template_id: string | null }>(
        db,
        'SELECT id,name,meta_template_id FROM public.message_templates WHERE id=$1 AND account_id=$2',
        [id, ctx.accountId]
      )
    );
    if (!existing) throw new RequestError('Template not found.', 404);
    if (existing.meta_template_id && !isDryRun()) {
      const config = await withAccount(ctx, (db) =>
        readWhatsAppConfig(db, ctx.accountId)
      );
      if (!config?.waba_id)
        throw new RequestError(
          'WhatsApp not configured — cannot delete on Meta.'
        );
      try {
        await deleteMessageTemplate({
          wabaId: config.waba_id,
          accessToken: decrypt(config.access_token),
          name: existing.name,
          metaTemplateId: existing.meta_template_id,
        });
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error ? error.message : 'Meta delete failed.',
          },
          { status: 502 }
        );
      }
    }
    const deleted = await withAccount(ctx, (db) =>
      queryRows(
        db,
        'DELETE FROM public.message_templates WHERE id=$1 AND account_id=$2 RETURNING id',
        [id, ctx.accountId]
      )
    );
    if (!deleted.length) throw new RequestError('Template not found.', 404);
    return Response.json({ success: true, dry_run: isDryRun() });
  } catch (error) {
    return localErrorResponse(error);
  }
}
