import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Small status / role pill used across the settings redesign
 * (Overview tiles, WhatsApp banner, the "Active" appearance markers).
 *
 * Status colours (emerald = good, amber = attention) follow the same
 * Tailwind palette the members tab already uses for role chips — they
 * are semantic accents, not neutrals, so they're intentionally not
 * tokenized. Neutrals stay on design tokens.
 */
export type ChipVariant = 'owner' | 'admin' | 'ok' | 'warn' | 'muted';

const VARIANTS: Record<ChipVariant, string> = {
  owner:
    'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  admin: 'border-primary-soft-2 bg-primary-soft text-primary',
  ok: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  muted: 'border-border bg-muted text-muted-foreground',
};

export function SettingsChip({
  variant = 'muted',
  className,
  children,
}: {
  variant?: ChipVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5',
        VARIANTS[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

/** A small live status dot (e.g. WhatsApp connected indicator). */
export function StatusDot({
  tone = 'ok',
  className,
}: {
  tone?: 'ok' | 'muted';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        tone === 'ok' ? 'bg-emerald-500' : 'bg-muted-foreground',
        className
      )}
    />
  );
}
