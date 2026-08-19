"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ACTION_ITEM_COLORS } from "@/lib/action-items/constants";
import { isOverdue, isToday, localDayKey } from "@/lib/action-items/date-utils";
import type { ActionItem } from "@/types";

function formatDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y}`;
}

interface ActionItemCardProps {
  item: ActionItem;
  /** Called with the card's own bounding box (captured synchronously
   *  at click time) so the detail popup can grow out of this exact
   *  card — see useFlipTransition. */
  onSelect: (item: ActionItem, originRect: DOMRect) => void;
}

/** Same visual language as the Pipeline's DealCard (rounded-xl,
 *  4px left accent bar) — AGENTS.md §12/§13 require reusing that exact
 *  card language, colored discreetly rather than filling the whole card.
 *  Memoized — same reasoning as PipelineBoard's DealCard: opening the
 *  detail popup only ever changes the page's `selected`/`originRect`
 *  state, unrelated to any card's own `item` prop, so re-rendering
 *  every sibling card on that update is pure waste that competes with
 *  the popup's own opening animation for the first frame. */
export const ActionItemCard = memo(function ActionItemCard({ item, onSelect }: ActionItemCardProps) {
  const t = useTranslations("ActionCenter.card");
  const contact = item.contact;
  const displayName = contact?.name || contact?.phone || t("noContact");
  const initial = (displayName.trim().charAt(0) || "?").toUpperCase();
  const color = ACTION_ITEM_COLORS[item.type];

  const todayKey = localDayKey(new Date());
  const overdue = item.type === "followup" && !!item.due_date && isOverdue(item.due_date, todayKey);
  const dueToday = item.type === "followup" && !!item.due_date && isToday(item.due_date, todayKey);

  function handleActivate(originRect: DOMRect) {
    onSelect(item, originRect);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => handleActivate(e.currentTarget.getBoundingClientRect())}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleActivate(e.currentTarget.getBoundingClientRect());
        }
      }}
      className={cn(
        "group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 py-3 pr-3 pl-4 text-left shadow-sm transition-all",
        "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg",
        dueToday && "ring-1 ring-emerald-500/40",
      )}
    >
      <span
        aria-hidden
        className="absolute top-0 left-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: color }}
      />

      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-foreground">
          {contact?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={contact.avatar_url} alt={displayName} className="h-8 w-8 rounded-full object-cover" />
          ) : (
            initial
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold leading-snug text-foreground">{displayName}</h4>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.title}</p>
        </div>
        {item.type === "followup" && item.due_date && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            {dueToday && (
              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
                {t("todayBadge")}
              </Badge>
            )}
            {overdue && (
              <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-400">
                {t("overdueBadge")}
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground">{formatDateLabel(item.due_date)}</span>
          </div>
        )}
      </div>
    </div>
  );
});
