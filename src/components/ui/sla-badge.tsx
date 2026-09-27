'use client';

import { Badge } from '@/components/ui/badge';
import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';

interface SlaBadgeProps {
  firstUnansweredAt?: string | null;
  /** In minutes */
  amberThreshold?: number;
  /** In minutes */
  redThreshold?: number;
  className?: string;
}

export function SlaBadge({
  firstUnansweredAt,
  amberThreshold = 5,
  redThreshold = 30,
  className = '',
}: SlaBadgeProps) {
  const [elapsedMinutes, setElapsedMinutes] = useState<number>(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    if (!firstUnansweredAt) return;

    const tick = () => {
      const start = new Date(firstUnansweredAt).getTime();
      const now = new Date().getTime();
      setElapsedMinutes(Math.max(0, Math.floor((now - start) / 60000)));
    };

    tick();
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
  }, [firstUnansweredAt]);

  if (!firstUnansweredAt || !mounted) return null;

  let colorClass = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
  if (elapsedMinutes >= redThreshold) {
    colorClass = 'bg-red-500/10 text-red-600 border-red-500/20';
  } else if (elapsedMinutes >= amberThreshold) {
    colorClass = 'bg-amber-500/10 text-amber-600 border-amber-500/20';
  }

  // Format the time human-readably
  let timeStr = `${elapsedMinutes}m`;
  if (elapsedMinutes >= 60) {
    const hours = Math.floor(elapsedMinutes / 60);
    const mins = elapsedMinutes % 60;
    timeStr = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }

  return (
    <Badge
      variant="outline"
      className={`flex items-center gap-1 font-medium ${colorClass} ${className}`}
    >
      <Clock className="h-3 w-3" />
      {timeStr}
    </Badge>
  );
}
