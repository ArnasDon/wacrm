"use client";

// LuLu Engagement overview (PRD §22). English-only for now: the LuLu
// module is intentionally kept out of the upstream i18n catalogues.
// Reads the synced customer read-model under RLS (any member may read).

import { useCallback, useEffect, useState } from "react";
import { Crown, Moon, TrendingDown, UserCheck, UserMinus, Users, BellOff, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { MetricCard } from "@/components/dashboard/metric-card";

interface Counts {
  total: number;
  active: number;
  atRisk: number;
  dormant: number;
  lost: number;
  newOrFirst: number;
  vip: number;
  optedIn: number;
  campaignEligible: number;
}

interface SyncInfo {
  finished_at: string | null;
  status: string;
  rows_upserted: number;
  rows_failed: number;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export default function EngagementPage() {
  const { accountId } = useAuth();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [sync, setSync] = useState<SyncInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const base = () =>
      supabase
        .from("lulu_customer_profiles")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId);

    try {
      const [total, active, atRisk, dormant, lost, fresh, first, vip, optedIn, eligible, syncRes] =
        await Promise.all([
          base(),
          base().eq("lifecycle_stage", "ACTIVE"),
          base().eq("lifecycle_stage", "AT_RISK"),
          base().eq("lifecycle_stage", "DORMANT"),
          base().eq("lifecycle_stage", "LOST"),
          base().eq("lifecycle_stage", "NEW"),
          base().eq("lifecycle_stage", "FIRST_ORDER"),
          base().eq("vip_flag", true),
          base().eq("marketing_opt_in", true),
          // Reachable today: opted in, no open complaint, linked to a WhatsApp contact.
          base()
            .eq("marketing_opt_in", true)
            .eq("active_complaint", false)
            .not("contact_id", "is", null),
          supabase
            .from("lulu_customer_sync_log")
            .select("finished_at, status, rows_upserted, rows_failed")
            .eq("account_id", accountId)
            .order("started_at", { ascending: false })
            .limit(1),
        ]);

      const firstErr = [total, active, atRisk, dormant, lost, fresh, first, vip, optedIn, eligible].find(
        (r) => r.error,
      )?.error;
      if (firstErr) throw new Error(firstErr.message);

      setCounts({
        total: total.count ?? 0,
        active: active.count ?? 0,
        atRisk: atRisk.count ?? 0,
        dormant: dormant.count ?? 0,
        lost: lost.count ?? 0,
        newOrFirst: (fresh.count ?? 0) + (first.count ?? 0),
        vip: vip.count ?? 0,
        optedIn: optedIn.count ?? 0,
        campaignEligible: eligible.count ?? 0,
      });
      setSync((syncRes.data?.[0] as SyncInfo | undefined) ?? null);
    } catch (e) {
      setError(
        e instanceof Error && /lulu_customer_profiles/.test(e.message)
          ? "LuLu tables not found — run migration 043 in Supabase."
          : e instanceof Error
            ? e.message
            : "Failed to load engagement data",
      );
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Customer Engagement</h1>
          <p className="text-sm text-muted-foreground">
            Lifecycle overview of customers synced from BigQuery.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {counts && counts.total === 0 && !error && (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          No customers synced yet. Send a batch to{" "}
          <code className="rounded bg-muted px-1 py-0.5">POST /api/v1/lulu/customers/sync</code> with an API key
          that has the <code className="rounded bg-muted px-1 py-0.5">contacts:write</code> scope. See
          docs/lulu/sync-api.md.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Total customers" value={counts ? fmt(counts.total) : "—"} icon={Users} />
        <MetricCard
          title="Active"
          value={counts ? fmt(counts.active) : "—"}
          icon={UserCheck}
          subtitle={counts ? `${fmt(counts.newOrFirst)} new / first-order` : undefined}
        />
        <MetricCard title="At risk" value={counts ? fmt(counts.atRisk) : "—"} icon={TrendingDown} />
        <MetricCard title="Dormant" value={counts ? fmt(counts.dormant) : "—"} icon={Moon} />
        <MetricCard title="Lost" value={counts ? fmt(counts.lost) : "—"} icon={UserMinus} />
        <MetricCard title="VIP" value={counts ? fmt(counts.vip) : "—"} icon={Crown} />
        <MetricCard
          title="Campaign eligible"
          value={counts ? fmt(counts.campaignEligible) : "—"}
          icon={UserCheck}
          subtitle="Opted in, no open complaint, linked to WhatsApp contact"
        />
        <MetricCard
          title="Opted out"
          value={counts ? fmt(counts.total - counts.optedIn) : "—"}
          icon={BellOff}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {sync?.finished_at
          ? `Last sync: ${new Date(sync.finished_at).toLocaleString()} — ${sync.status}, ${fmt(sync.rows_upserted)} saved, ${fmt(sync.rows_failed)} failed`
          : "No sync has completed yet."}
      </p>
    </div>
  );
}
