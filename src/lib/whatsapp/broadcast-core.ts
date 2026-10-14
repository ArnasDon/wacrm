import type { SqlConnection } from '@/lib/db/transaction';
import { queryRows } from '@/lib/db/rows';
import { BroadcastStore } from '@/lib/db/broadcasts';
import { findOrCreateApiContact } from '@/lib/db/public-api';
import { resolveLocalTemplate } from './template-local';
import { sendTemplateMessage } from './meta-api';
import { decrypt } from './encryption';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from './phone-utils';
import type { MessageTemplate } from '@/types';
import type { SendTimeParams } from './template-send-builder';
export class BroadcastError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'BroadcastError';
  }
}
export interface BroadcastRecipientInput {
  to: string;
  params?: string[];
}
export interface CreateBroadcastParams {
  name?: string | null;
  templateName: string;
  templateLanguage?: string | null;
  recipients: BroadcastRecipientInput[];
}
export interface BroadcastPlan {
  accountId: string;
  broadcastId: string;
  templateName: string;
  templateLanguage: string;
  phoneNumberId: string;
  accessToken: string;
  templateRow: MessageTemplate | null;
  planned: { recipientRowId: string; phone: string; params: string[] }[];
  rejected: number;
  messageParams?: SendTimeParams;
}
export async function loadBroadcastCredentials(
  db: SqlConnection,
  accountId: string
) {
  const [config] = await queryRows<{
    phone_number_id: string;
    access_token: string;
  }>(
    db,
    'SELECT phone_number_id,access_token FROM public.whatsapp_config WHERE account_id=$1',
    [accountId]
  );
  if (!config)
    throw new BroadcastError(
      'whatsapp_not_configured',
      'Configure WhatsApp first.',
      400
    );
  return {
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
  };
}
/** Caller supplies a transaction: contact resolution, campaign and recipient inserts commit together. */
export async function createBroadcast(
  db: SqlConnection,
  accountId: string,
  auditUserId: string,
  input: CreateBroadcastParams
): Promise<BroadcastPlan> {
  if (!input.templateName)
    throw new BroadcastError('bad_request', 'Template name is required.', 400);
  if (
    !Array.isArray(input.recipients) ||
    !input.recipients.length ||
    input.recipients.length > 1000
  )
    throw new BroadcastError(
      'bad_request',
      'Provide between 1 and 1000 recipients.',
      400
    );
  const credentials = await loadBroadcastCredentials(db, accountId);
  const template = await resolveLocalTemplate(
    db,
    accountId,
    input.templateName,
    input.templateLanguage
  );
  if (template.malformed)
    throw new BroadcastError(
      'template_malformed',
      'Sync the template from Meta before broadcasting.',
      500
    );
  const recipients: { contactId: string; params: string[] }[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const r of input.recipients) {
    const phone = sanitizePhoneForMeta(typeof r?.to === 'string' ? r.to : '');
    if (!isValidE164(phone)) {
      rejected++;
      continue;
    }
    const { id } = await findOrCreateApiContact(db, accountId, auditUserId, {
      phone,
    });
    if (seen.has(id)) continue;
    seen.add(id);
    recipients.push({
      contactId: id,
      params: Array.isArray(r.params)
        ? r.params.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }
  if (!recipients.length)
    throw new BroadcastError(
      'bad_request',
      'No recipients had valid phone numbers.',
      400
    );
  const store = new BroadcastStore(db, accountId);
  const campaign = await store.create(auditUserId, {
    name: input.name || 'API broadcast (' + input.templateName + ')',
    templateName: input.templateName,
    language: template.language,
    recipients,
    variables: {},
    audience: {},
  });
  await store.claim(campaign.id);
  const rows = await store.recipients(campaign.id);
  return {
    accountId,
    broadcastId: campaign.id,
    templateName: input.templateName,
    templateLanguage: template.language,
    ...credentials,
    templateRow: template.row,
    planned: rows.map((r) => ({
      recipientRowId: r.id,
      phone: r.contact?.phone ?? '',
      params: r.template_params ?? [],
    })),
    rejected,
  };
}
/** Provider calls run outside transactions. Every write retains the account and campaign scope. */
export async function deliverBroadcast(
  db: SqlConnection,
  plan: BroadcastPlan
): Promise<void> {
  const store = new BroadcastStore(db, plan.accountId);
  let sent = 0;
  try {
    for (const recipient of plan.planned) {
      let messageId: string | null = null,
        lastError: string | null = null;
      for (const variant of phoneVariants(recipient.phone)) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: plan.phoneNumberId,
            accessToken: plan.accessToken,
            to: variant,
            templateName: plan.templateName,
            language: plan.templateLanguage,
            template: plan.templateRow ?? undefined,
            params: recipient.params,
            messageParams: plan.messageParams,
          });
          messageId = result.messageId;
          lastError = null;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown error';
          if (!isRecipientNotAllowedError(lastError)) break;
        }
      }
      await store.stamp(
        plan.broadcastId,
        recipient.recipientRowId,
        messageId,
        lastError
      );
      if (++sent % 10 === 0 && sent < plan.planned.length)
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    await store.finalize(plan.broadcastId);
    await store.release(plan.broadcastId);
  }
}
export function finalizeBroadcastStatus(
  db: SqlConnection,
  broadcastId: string,
  accountId: string
) {
  return new BroadcastStore(db, accountId).finalize(broadcastId);
}
