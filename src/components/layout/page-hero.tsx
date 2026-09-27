import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Page heading block: tinted icon tile, title, one-line description and
 * the page's primary actions, on a soft gradient card. Used by pages that
 * carry their own heading so the app header doesn't repeat the title
 * (see `HERO_PAGES` in header.tsx).
 */
export function PageHero({
  icon: Icon,
  iconClassName,
  title,
  description,
  actions,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  /** Colours for the icon tile, e.g. "bg-emerald-500/15 text-emerald-500". */
  iconClassName?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Extra content under the title row (chips, pickers, …). */
  children?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
      {/* Soft glow in the corner — decorative only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={cn(
              'flex size-12 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-inset ring-black/5',
              iconClassName ?? 'bg-primary/15 text-primary',
            )}
          >
            <Icon className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
            {description ? (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="relative mt-5">{children}</div> : null}
    </div>
  );
}
