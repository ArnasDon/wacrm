import type { BillingStatus } from '@/types';

/**
 * Display-only mapping — billing_status isn't read by any access rule
 * yet (see src/lib/billing/README.md), so this is purely informational
 * for the platform admin panel.
 */
export const BILLING_STATUS_LABEL: Record<BillingStatus, string> = {
  trial: 'Teste',
  active: 'Pago',
  past_due: 'Pagamento atrasado',
  canceled: 'Cancelado',
};

export const BILLING_STATUS_VARIANT: Record<BillingStatus, 'ok' | 'warn' | 'muted'> = {
  trial: 'muted',
  active: 'ok',
  past_due: 'warn',
  canceled: 'warn',
};
