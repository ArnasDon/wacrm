/**
 * Shared display config for message_templates.status.
 *
 * The DB stores Meta's raw enum (DRAFT / APPROVED / PENDING / REJECTED /
 * PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION) — the UI maps it to
 * a human label + dark-theme badge classes here so the template manager,
 * inbox picker, and broadcast picker stay aligned. The label is looked
 * up via next-intl (`Settings.templates.status*` keys) rather than
 * hardcoded here, so callers must pass their `t` function in.
 */

import type { MessageTemplateStatus } from '@/types';

export interface TemplateStatusDisplay {
  label: string;
  classes: string;
}

const STATUS_CLASSES: Record<MessageTemplateStatus, string> = {
  DRAFT: 'bg-slate-600/20 text-muted-foreground border-slate-600/30',
  PENDING: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  APPROVED: 'bg-primary/20 text-primary border-primary/30',
  REJECTED: 'bg-red-600/20 text-red-400 border-red-600/30',
  PAUSED: 'bg-orange-600/20 text-orange-400 border-orange-600/30',
  DISABLED: 'bg-red-900/30 text-red-500 border-red-900/40',
  IN_APPEAL: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  PENDING_DELETION: 'bg-slate-700/30 text-muted-foreground border-slate-700/40',
};

const STATUS_LABEL_KEYS: Record<MessageTemplateStatus, string> = {
  DRAFT: 'statusDraft',
  PENDING: 'statusPending',
  APPROVED: 'statusApproved',
  REJECTED: 'statusRejected',
  PAUSED: 'statusPaused',
  DISABLED: 'statusDisabled',
  IN_APPEAL: 'statusInAppeal',
  PENDING_DELETION: 'statusPendingDeletion',
};

export function getTemplateStatusDisplay(
  status: MessageTemplateStatus,
  t: (key: string) => string,
): TemplateStatusDisplay {
  return {
    label: t(STATUS_LABEL_KEYS[status]),
    classes: STATUS_CLASSES[status],
  };
}

// Shared with the inbox TemplatePicker so a category badge reads the
// same translated word everywhere a template shows up, not just in
// Settings. Keys live under Settings.templates (the category concept
// belongs to template management, not to any one consumer of it).
export const TEMPLATE_CATEGORY_LABEL_KEYS: Record<
  'Marketing' | 'Utility' | 'Authentication',
  string
> = {
  Marketing: 'categoryMarketing',
  Utility: 'categoryUtility',
  Authentication: 'categoryAuthentication',
};

export function getTemplateCategoryLabel(
  category: 'Marketing' | 'Utility' | 'Authentication',
  t: (key: string) => string,
): string {
  return t(TEMPLATE_CATEGORY_LABEL_KEYS[category]);
}
