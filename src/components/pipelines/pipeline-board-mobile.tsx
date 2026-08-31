"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import type { Deal, PipelineStage } from "@/types";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DealCard } from "./deal-card";

interface PipelineBoardMobileProps {
  sortedStages: PipelineStage[];
  dealsByStage: Map<string, Deal[]>;
  currency: string;
  onDealMoved: (dealId: string, newStageId: string) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  onOpenChat?: (deal: Deal) => void;
}

/**
 * Phone/tablet pipeline: no horizontal Kanban (swiping to reach a
 * hidden column kept dropping cards into the wrong stage). Instead a
 * scrollable row of stage tabs picks ONE stage, and its deals show as
 * a plain vertical list. Moving a deal is a tap on its "Mover" menu →
 * pick the target stage — same `onDealMoved` path as the desktop drag.
 */
export function PipelineBoardMobile({
  sortedStages,
  dealsByStage,
  currency,
  onDealMoved,
  onAddDeal,
  onEditDeal,
  onOpenChat,
}: PipelineBoardMobileProps) {
  const t = useTranslations("Pipelines.board");

  const [activeStageId, setActiveStageId] = useState(
    () => sortedStages[0]?.id ?? "",
  );

  // Keep the selection valid when stages change (rename keeps the id;
  // a delete does not).
  useEffect(() => {
    if (sortedStages.length === 0) return;
    if (!sortedStages.some((s) => s.id === activeStageId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveStageId(sortedStages[0].id);
    }
  }, [sortedStages, activeStageId]);

  const activeStage = useMemo(
    () => sortedStages.find((s) => s.id === activeStageId) ?? null,
    [sortedStages, activeStageId],
  );
  const activeDeals = activeStage ? (dealsByStage.get(activeStage.id) ?? []) : [];
  const totalValue = activeDeals.reduce((s, d) => s + Number(d.value || 0), 0);

  if (!activeStage) return null;

  return (
    <div className="flex flex-col gap-3 pb-4">
      {/* Stage tabs — horizontal scroll, navigation only (no dnd). */}
      <div
        role="tablist"
        aria-label={t("stageTabsLabel")}
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {sortedStages.map((stage) => {
          const count = dealsByStage.get(stage.id)?.length ?? 0;
          const isActive = stage.id === activeStageId;
          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveStageId(stage.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: stage.color }}
              />
              <span className="whitespace-nowrap">{stage.name}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold",
                  isActive
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected stage header */}
      <div className="flex items-baseline justify-between px-1">
        <h3 className="text-sm font-semibold text-foreground">
          {activeStage.name}
        </h3>
        <span className="text-xs text-muted-foreground">
          {formatCurrency(totalValue, currency)}
        </span>
      </div>

      {/* Deals — plain vertical list */}
      <div className="flex flex-col gap-2">
        {activeDeals.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border py-10 text-center text-xs text-muted-foreground">
            {t("noDealsInStage")}
          </div>
        ) : (
          activeDeals.map((deal) => (
            <div key={deal.id} className="flex flex-col">
              <DealCard
                deal={deal}
                stage={activeStage}
                onEdit={onEditDeal}
                onOpenChat={onOpenChat}
              />
              <div className="mt-1 flex justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t("moveDeal", { title: deal.title })}
                  >
                    <ArrowRight className="size-3.5" />
                    {t("move")}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuLabel>{t("moveTo")}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {sortedStages.map((s) => (
                      <DropdownMenuItem
                        key={s.id}
                        disabled={s.id === deal.stage_id}
                        onClick={() => {
                          if (s.id !== deal.stage_id) onDealMoved(deal.id, s.id);
                        }}
                      >
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddDeal(activeStage.id)}
        className="w-full justify-start border border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="mr-1 h-3 w-3" />
        {t("addDeal")}
      </Button>
    </div>
  );
}
