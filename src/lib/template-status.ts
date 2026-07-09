/**
 * Shared display config for message_templates.status.
 *
 * The DB stores Meta's raw enum (DRAFT / APPROVED / PENDING / REJECTED /
 * PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION) — the UI maps it to
 * a human label + dark-theme badge classes here so the template manager,
 * inbox picker, and broadcast picker stay aligned.
 */

import type { MessageTemplateStatus } from '@/types';

export interface TemplateStatusDisplay {
  label: string;
  classes: string;
}

export const templateStatusConfig: Record<
  MessageTemplateStatus,
  TemplateStatusDisplay
> = {
  DRAFT: {
    label: 'Borrador',
    classes: 'bg-slate-600/20 text-muted-foreground border-slate-600/30',
  },
  PENDING: {
    label: 'Pendiente',
    classes: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  },
  APPROVED: {
    label: 'Aprobada',
    classes: 'bg-primary/20 text-primary border-primary/30',
  },
  REJECTED: {
    label: 'Rechazada',
    classes: 'bg-red-600/20 text-red-400 border-red-600/30',
  },
  PAUSED: {
    label: 'Pausada',
    classes: 'bg-orange-600/20 text-orange-400 border-orange-600/30',
  },
  DISABLED: {
    label: 'Deshabilitada',
    classes: 'bg-red-900/30 text-red-500 border-red-900/40',
  },
  IN_APPEAL: {
    label: 'En apelación',
    classes: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  },
  PENDING_DELETION: {
    label: 'Eliminación pendiente',
    classes: 'bg-slate-700/30 text-muted-foreground border-slate-700/40',
  },
};
