import type { SqlConnection } from '@/lib/db/transaction';
import { BroadcastStore } from '@/lib/db/broadcasts';
import {
  BroadcastError,
  loadBroadcastCredentials,
  type BroadcastPlan,
} from './broadcast-core';
import { resolveLocalTemplate } from './template-local';
import { sanitizePhoneForMeta, isValidE164 } from './phone-utils';
export type ResumeScope = 'pending' | 'failed' | 'all';
export const RESUME_SCOPES: readonly ResumeScope[] = [
  'pending',
  'failed',
  'all',
];
export const RESUME_MAX_PER_REQUEST = 1000;
export const DELIVERY_LOCK_STALE_MS = 1800000;
export function claimBroadcastDelivery(
  db: SqlConnection,
  accountId: string,
  id: string,
  now?: Date
) {
  return new BroadcastStore(db, accountId).claim(id, now);
}
export function releaseBroadcastDelivery(
  db: SqlConnection,
  id: string,
  accountId: string
) {
  return new BroadcastStore(db, accountId).release(id);
}
export function markBroadcastSending(
  db: SqlConnection,
  id: string,
  accountId: string
) {
  return new BroadcastStore(db, accountId).sending(id);
}
export interface ResumePlan {
  plan: BroadcastPlan;
  remaining: number;
  unsendable: number;
}
export async function planBroadcastResume(
  db: SqlConnection,
  accountId: string,
  id: string,
  scope: ResumeScope
): Promise<ResumePlan> {
  const store = new BroadcastStore(db, accountId);
  const campaign = await store.get(id);
  if (!campaign)
    throw new BroadcastError('not_found', 'Broadcast not found.', 404);
  const credentials = await loadBroadcastCredentials(db, accountId);
  const template = await resolveLocalTemplate(
    db,
    accountId,
    campaign.template_name,
    campaign.template_language
  );
  if (template.malformed)
    throw new BroadcastError(
      'template_malformed',
      'Sync the template from Meta first.',
      500
    );
  const rows = await store.recipients(
    id,
    scope === 'all' ? ['pending', 'failed'] : [scope]
  );
  const planned: BroadcastPlan['planned'] = [];
  let unsendable = 0,
    remaining = 0;
  for (const row of rows) {
    const phone = sanitizePhoneForMeta(row.contact?.phone ?? '');
    if (!isValidE164(phone)) {
      unsendable++;
      await store.stamp(id, row.id, null, 'No valid phone number on contact');
      continue;
    }
    if (planned.length >= RESUME_MAX_PER_REQUEST) {
      remaining++;
      continue;
    }
    planned.push({
      recipientRowId: row.id,
      phone,
      params: Array.isArray(row.template_params)
        ? row.template_params.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }
  if (!planned.length && !unsendable)
    throw new BroadcastError(
      'nothing_to_resume',
      'No recipients left in this scope.',
      400
    );
  const headerMediaUrl = campaign.audience_filter?.headerMediaUrl;
  return {
    plan: {
      accountId,
      broadcastId: id,
      templateName: campaign.template_name,
      templateLanguage: template.language,
      ...credentials,
      templateRow: template.row,
      planned,
      rejected: 0,
      ...(typeof headerMediaUrl === 'string' && headerMediaUrl
        ? { messageParams: { headerMediaUrl } }
        : {}),
    },
    remaining,
    unsendable,
  };
}
