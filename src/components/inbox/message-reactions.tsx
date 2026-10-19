"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { MessageReaction } from "@/types";
import { groupReactions } from "@/lib/inbox/business-reaction";

interface MessageReactionsProps {
  reactions: MessageReaction[];
  /** Toggle the agent's reaction. If the agent already has this emoji →
   *  caller should send empty to remove; otherwise swap/add. */
  onToggle: (emoji: string) => void;
}

export function MessageReactions({
  reactions,
  onToggle,
}: MessageReactionsProps) {
  const groups = useMemo(() => groupReactions(reactions), [reactions]);

  if (groups.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {groups.map((g) => (
        <button
          key={g.emoji}
          type="button"
          onClick={() => onToggle(g.emoji)}
          aria-pressed={g.byBusiness}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none transition-colors",
            g.byBusiness
              ? "border-primary/60 bg-primary/15 text-primary hover:bg-primary/25"
              : "border-border bg-muted/80 text-foreground hover:bg-muted",
          )}
        >
          <span className="text-sm leading-none">{g.emoji}</span>
          {g.count > 1 && <span>{g.count}</span>}
        </button>
      ))}
    </div>
  );
}
