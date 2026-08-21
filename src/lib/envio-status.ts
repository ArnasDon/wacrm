/**
 * Status badge config for Envios (lotes + leads) — same shape as
 * `src/lib/broadcast-status.ts` (`{label, classes, pulse?}`), one
 * source of truth reused by the Envios list, detail, and lead table.
 */

import type { EnvioLoteStatus, EnvioLeadStatus } from '@/types';
import type { StatusDisplay } from '@/lib/broadcast-status';

export const loteStatusConfig: Record<EnvioLoteStatus, StatusDisplay> = {
  aguardando: {
    label: 'aguardando',
    classes: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
  },
  em_andamento: {
    label: 'em_andamento',
    classes: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    pulse: true,
  },
  pausado: {
    label: 'pausado',
    classes: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  concluido: {
    label: 'concluido',
    classes: 'bg-primary/10 text-primary border-primary/20',
  },
};

export const envioLeadStatusConfig: Record<EnvioLeadStatus, StatusDisplay> = {
  na_fila: {
    label: 'na_fila',
    classes: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
  },
  enviando: {
    label: 'enviando',
    classes: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    pulse: true,
  },
  enviado: {
    label: 'enviado',
    classes: 'bg-primary/10 text-primary border-primary/20',
  },
  falhou: {
    label: 'falhou',
    classes: 'bg-red-500/10 text-red-400 border-red-500/20',
  },
};

export function getLoteStatus(status: string): StatusDisplay {
  return loteStatusConfig[status as EnvioLoteStatus] ?? loteStatusConfig.aguardando;
}

export function getEnvioLeadStatus(status: string): StatusDisplay {
  return envioLeadStatusConfig[status as EnvioLeadStatus] ?? envioLeadStatusConfig.na_fila;
}
