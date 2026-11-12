import { Crown } from "lucide-react";

interface OwnerBadgeProps {
  label: string;
}

export function OwnerBadge({ label }: OwnerBadgeProps) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-300">
      <Crown className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}
