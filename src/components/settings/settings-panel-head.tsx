import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Section header shown at the top of every settings panel — a title,
 * a one-line description, and an optional right-aligned action (e.g.
 * "New template", "Invite member"). Mirrors the mockup's `.panel-head`.
 */
export function SettingsPanelHead({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="text-foreground text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground mt-1 max-w-[62ch] text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
