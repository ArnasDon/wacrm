"use client";

import { useMemo } from "react";
import type { Deal, PipelineStage } from "@/types";
import {
  DollarSign,
  TrendingUp,
  Target,
  BarChart3,
  Trophy,
  XCircle,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";

interface PipelineAnalyticsProps {
  stages: PipelineStage[];
  /** Deals for the metric cards above — respects the board's own
   *  vendor filter/"mine" toggle, so the headline numbers match what's
   *  visible on the board underneath them. */
  deals: Deal[];
  /** Every deal in the pipeline, filter-independent — the per-vendor
   *  breakdown below always compares the whole team, otherwise
   *  filtering to "mine" would hide the very comparison it's for.
   *  Falls back to `deals` when omitted. */
  teamDeals?: Deal[];
}

/**
 * Weighted pipeline value: value × per-stage probability.
 * First stage ≈ 10%, stages interpolate up to 90% before the final stage,
 * final stage (Won) = 100%. Lost deals excluded.
 */
function computeStageProbability(
  stage: PipelineStage,
  sortedStages: PipelineStage[],
): number {
  const n = sortedStages.length;
  if (n <= 1) return 1;
  const index = sortedStages.findIndex((s) => s.id === stage.id);
  if (index < 0) return 0;
  if (index === n - 1) return 1;
  const slots = n - 1;
  if (slots <= 1) return 0.1;
  const t = index / (slots - 1);
  return 0.1 + t * (0.9 - 0.1);
}

export function PipelineAnalytics({ stages, deals, teamDeals }: PipelineAnalyticsProps) {
  const t = useTranslations("Pipelines.analytics");
  const { defaultCurrency } = useAuth();
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const stats = useMemo(() => {
    const active = deals.filter((d) => d.status !== "lost");
    const openDeals = active.filter((d) => d.status !== "won");

    const totalCount = active.length;
    const totalValue = active.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const avgValue = totalCount > 0 ? totalValue / totalCount : 0;

    const stageById = new Map(sortedStages.map((s) => [s.id, s]));
    const weightedValue = openDeals.reduce((sum, d) => {
      const stage = stageById.get(d.stage_id);
      if (!stage) return sum;
      const prob = computeStageProbability(stage, sortedStages);
      return sum + Number(d.value || 0) * prob;
    }, 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = (d: Deal) => {
      // closed_at (migration 039) is the real close date and is only
      // ever set on the won/lost transition; updated_at/created_at
      // stay as fallbacks for deals closed before that migration ran
      // and never touched since (their closed_at was backfilled from
      // updated_at, so this order changes nothing for them either).
      const ts = d.closed_at ?? d.updated_at ?? d.created_at;
      return ts ? new Date(ts) >= monthStart : false;
    };
    const wonThisMonth = deals.filter(
      (d) => d.status === "won" && thisMonth(d),
    ).length;
    const lostThisMonth = deals.filter(
      (d) => d.status === "lost" && thisMonth(d),
    ).length;

    return {
      totalCount,
      totalValue,
      avgValue,
      weightedValue,
      wonThisMonth,
      lostThisMonth,
    };
  }, [deals, sortedStages]);

  const byVendor = useMemo(
    () => computeVendorStats(teamDeals ?? deals),
    [teamDeals, deals],
  );

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-3 xl:grid-cols-6">
        <Metric
          icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
          label={t("totalDeals")}
          value={String(stats.totalCount)}
          tooltip={t("totalDealsTooltip")}
          t={t}
        />
        <Metric
          icon={<DollarSign className="h-4 w-4 text-primary" />}
          label={t("pipelineValue")}
          value={formatCurrency(stats.totalValue, defaultCurrency)}
          tooltip={t("pipelineValueTooltip")}
          t={t}
        />
        <Metric
          icon={<Target className="h-4 w-4 text-blue-400" />}
          label={t("avgDealSize")}
          value={formatCurrency(stats.avgValue, defaultCurrency)}
          tooltip={t("avgDealSizeTooltip")}
          t={t}
        />
        <Metric
          icon={<TrendingUp className="h-4 w-4 text-purple-400" />}
          label={t("weightedValue")}
          value={formatCurrency(stats.weightedValue, defaultCurrency)}
          tooltip={t("weightedValueTooltip")}
          t={t}
        />
        <Metric
          icon={<Trophy className="h-4 w-4 text-primary" />}
          label={t("wonThisMonth")}
          value={String(stats.wonThisMonth)}
          tooltip={t("wonThisMonthTooltip")}
          t={t}
        />
        <Metric
          icon={<XCircle className="h-4 w-4 text-red-400" />}
          label={t("lostThisMonth")}
          value={String(stats.lostThisMonth)}
          tooltip={t("lostThisMonthTooltip")}
          t={t}
        />
      </div>

      {byVendor.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card/60 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("byVendor")}
          </h3>
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 font-medium">{t("vendor")}</th>
                <th className="pb-2 font-medium text-right">{t("vendorDeals")}</th>
                <th className="pb-2 font-medium text-right">{t("vendorValue")}</th>
                <th className="pb-2 font-medium text-right">{t("vendorWon")}</th>
                <th className="pb-2 font-medium text-right">{t("vendorConversion")}</th>
              </tr>
            </thead>
            <tbody>
              {byVendor.map((v) => (
                <tr key={v.key} className="border-b border-border/50 last:border-0">
                  <td className="py-2 text-foreground">
                    {v.key === "unassigned" ? t("unassigned") : v.name}
                  </td>
                  <td className="py-2 text-right tabular-nums text-foreground">{v.dealCount}</td>
                  <td className="py-2 text-right tabular-nums text-foreground">
                    {formatCurrency(v.totalValue, defaultCurrency)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-foreground">{v.wonCount}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {v.conversionRate === null
                      ? t("notAvailable")
                      : `${Math.round(v.conversionRate * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TooltipProvider>
  );
}

interface VendorStat {
  key: string;
  name: string;
  /** Active (non-lost) deals — same "active" definition as the
   *  headline pipeline-value metric above. */
  dealCount: number;
  totalValue: number;
  wonCount: number;
  /** won / (won + lost). Null when nothing has been decided yet, so
   *  the table can show "n/a" instead of a misleading 0%. */
  conversionRate: number | null;
}

/**
 * Group deals by `assigned_to` (falling back to an "unassigned"
 * bucket) and roll up the same active/value/won shape the headline
 * metrics use, per vendor. Pure — testable without a component render.
 */
function computeVendorStats(deals: Deal[]): VendorStat[] {
  const groups = new Map<string, { name: string; deals: Deal[] }>();
  for (const d of deals) {
    const key = d.assigned_to ?? "unassigned";
    const existing = groups.get(key);
    if (existing) {
      existing.deals.push(d);
    } else {
      groups.set(key, { name: d.assignee?.full_name ?? "", deals: [d] });
    }
  }

  const stats: VendorStat[] = [];
  for (const [key, group] of groups) {
    const active = group.deals.filter((d) => d.status !== "lost");
    const won = group.deals.filter((d) => d.status === "won");
    const lost = group.deals.filter((d) => d.status === "lost");
    const decided = won.length + lost.length;
    stats.push({
      key,
      name: group.name,
      dealCount: active.length,
      totalValue: active.reduce((sum, d) => sum + Number(d.value || 0), 0),
      wonCount: won.length,
      conversionRate: decided > 0 ? won.length / decided : null,
    });
  }

  // Unassigned always last; everyone else by pipeline value, highest first.
  return stats.sort((a, b) => {
    if (a.key === "unassigned") return 1;
    if (b.key === "unassigned") return -1;
    return b.totalValue - a.totalValue;
  });
}

function Metric({
  icon,
  label,
  value,
  tooltip,
  t,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={t("howCalculated", { label })}
                className="ml-auto text-muted-foreground hover:text-foreground focus:outline-none"
              />
            }
          >
            <Info className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}
