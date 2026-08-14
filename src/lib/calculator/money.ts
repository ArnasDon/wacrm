// Calculadora de Fluxo Imobiliário — pt-BR money formatting/parsing.
//
// Deliberately separate from src/lib/currency.ts (the app-wide
// formatCurrency), which is USD-first, whole-number-only, and shared
// by deals/pipelines/broadcasts — changing it would ripple outside
// this module. The calculator is a Brazilian real-estate tool that
// always needs "R$ 1.234.567,89"-style output regardless of the
// account's configured default_currency, so it gets its own tiny
// formatter instead.

const BRL_CURRENCY = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const BRL_NUMBER = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "R$ 300.000,00" */
export function formatBRL(value: number): string {
  return BRL_CURRENCY.format(Number(value) || 0);
}

/** "300.000,00" — no currency symbol, for inputs that render R$ separately. */
export function formatBRLNumber(value: number): string {
  return BRL_NUMBER.format(Number(value) || 0);
}

const PERCENT_NUMBER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** "10" / "12,5" — no "%" suffix, callers render that themselves. */
export function formatPercentNumber(value: number): string {
  return PERCENT_NUMBER.format(Number(value) || 0);
}

/**
 * Parses the raw text of a cents-mask money input (digits-only, right
 * to left, like every Brazilian banking app) into a reais value.
 * Typing "300000" produces "R$ 3.000,00" digit by digit, ending at
 * "R$ 300.000,00" — never a plain "R$ 300.000" the user has to divide
 * by 100 in their head.
 */
export function parseMoneyInputDigits(raw: string): number {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
}
