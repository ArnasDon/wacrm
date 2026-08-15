import { Badge } from '@/components/ui/badge';
import type { LeadTemperature } from '@/types';

const STYLES: Record<LeadTemperature, string> = {
  cold: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  warm: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  hot: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

interface LeadTemperatureBadgeProps {
  value: LeadTemperature | null | undefined;
  labels: Record<LeadTemperature, string>;
  unclassifiedLabel?: string;
}

export function LeadTemperatureBadge({
  value,
  labels,
  unclassifiedLabel,
}: LeadTemperatureBadgeProps) {
  if (!value) {
    return unclassifiedLabel ? (
      <Badge variant="outline" className="text-muted-foreground">
        {unclassifiedLabel}
      </Badge>
    ) : null;
  }

  return (
    <Badge variant="outline" className={STYLES[value]}>
      {labels[value]}
    </Badge>
  );
}
