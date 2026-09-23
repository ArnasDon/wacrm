import { BarChart3 } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

import { useTranslations } from 'next-intl';

/**
 * Shared empty-state panel for charts that can't render meaningfully
 * without a minimum amount of data. Kept minimal and uniform so the
 * three empty states on the dashboard don't each feel like a
 * different widget.
 */
export function EmptyState({
  title,
  hint,
  icon: Icon = BarChart3,
  className,
}: {
  title?: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
}) {
  const t = useTranslations('Dashboard.emptyState');
  const defaultTitle = t('title');

  return (
    <div
      className={cn(
        'border-border bg-card/40 flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center',
        className
      )}
    >
      <div className="bg-muted text-muted-foreground flex h-10 w-10 items-center justify-center rounded-full">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-muted-foreground text-sm font-medium">
        {title || defaultTitle}
      </p>
      {hint && <p className="text-muted-foreground max-w-xs text-xs">{hint}</p>}
    </div>
  );
}
