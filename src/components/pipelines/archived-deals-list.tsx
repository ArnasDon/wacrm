"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DealCard } from "./deal-card";
import type { Deal, PipelineStage, Tag } from "@/types";

interface ArchivedDealsListProps {
  deals: Deal[];
  stages: PipelineStage[];
  onEditDeal: (deal: Deal, originRect?: DOMRect) => void;
  onRequestRestoreDeal: (deal: Deal) => void;
  onRequestDeleteDeal: (deal: Deal) => void;
}

/**
 * Flat grid for "Leads Arquivados" — deliberately not the Kanban board
 * (no stages to drop into here, no drag). Supports search (name/phone)
 * and a tag filter, per AGENTS spec §2. Cards reuse DealCard exactly —
 * same visual language, "⋮" menu swapped to "Restaurar" (no
 * "Arquivar"/stage-move affordance while already archived).
 */
export function ArchivedDealsList({
  deals,
  stages,
  onEditDeal,
  onRequestRestoreDeal,
  onRequestDeleteDeal,
}: ArchivedDealsListProps) {
  const t = useTranslations("Pipelines.archived");
  const [search, setSearch] = useState("");
  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const deal of deals) {
      for (const tag of deal.contact?.tags ?? []) map.set(tag.id, tag);
    }
    return Array.from(map.values());
  }, [deals]);

  const filteredDeals = useMemo(() => {
    const query = search.trim().toLowerCase();
    return deals.filter((deal) => {
      if (activeTagId && !(deal.contact?.tags ?? []).some((tag) => tag.id === activeTagId)) {
        return false;
      }
      if (!query) return true;
      const name = deal.contact?.name?.toLowerCase() ?? "";
      const phone = deal.contact?.phone?.toLowerCase() ?? "";
      return name.includes(query) || phone.includes(query);
    });
  }, [deals, search, activeTagId]);

  const stageById = useMemo(() => {
    const map = new Map<string, PipelineStage>();
    for (const stage of stages) map.set(stage.id, stage);
    return map;
  }, [stages]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-card pl-8 text-foreground"
          />
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTagId(null)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                activeTagId === null
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {t("allTags")}
            </button>
            {allTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => setActiveTagId(activeTagId === tag.id ? null : tag.id)}
                className="rounded-full px-2.5 py-1 text-xs font-medium transition-opacity"
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                  opacity: activeTagId && activeTagId !== tag.id ? 0.45 : 1,
                }}
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-dashed border-border p-3">
        {deals.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("empty")}
          </div>
        ) : filteredDeals.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t("noResults")}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredDeals.map((deal) => (
              <div key={deal.id}>
                <DealCard
                  deal={deal}
                  stage={stageById.get(deal.stage_id) ?? null}
                  onEdit={onEditDeal}
                  onRequestRestore={onRequestRestoreDeal}
                  onRequestDelete={onRequestDeleteDeal}
                />
                <p className="mt-1 truncate px-1 text-[11px] text-muted-foreground">
                  {t("stagePrefix")} {stageById.get(deal.stage_id)?.name ?? "—"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
