"use client";

// Campaign admin + dry run (PRD §32, §77, §79). Nothing here sends a message.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FlaskConical, Loader2, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_CAMPAIGN_ROWS, PRIORITY_CLASS_BY_TYPE, type CampaignType, type DryRunReport } from "@/lib/lulu";

interface CampaignRow {
  id: string;
  campaign_code: string;
  name: string;
  campaign_type: CampaignType;
  rule_params: Record<string, unknown> | null;
  status: string;
  mode: string;
  active: boolean;
}

const fmt = (n: number) => n.toLocaleString("en-US");

const REASON_LABEL: Record<string, string> = {
  lower_priority: "lost to a higher-priority campaign",
  opted_out: "opted out",
  suspected_shared_number: "suspected shared number",
  active_complaint: "open complaint",
  ordered_recently: "ordered in the last 24 h",
  already_received_campaign: "already received",
  marketing_frequency_cap: "marketing frequency cap",
  promo_frequency_cap: "promo frequency cap",
};

export default function CampaignsPage() {
  const { accountId } = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dry, setDry] = useState<{ report: DryRunReport; dataAsOf: string | null } | null>(null);
  const [dryError, setDryError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, error: err } = await createClient()
      .from("lulu_campaigns")
      .select("id, campaign_code, name, campaign_type, rule_params, status, mode, active")
      .eq("account_id", accountId)
      .order("priority");
    if (err) setError(err.message);
    else {
      setError(null);
      setCampaigns((data ?? []) as CampaignRow[]);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createDefaults = async () => {
    if (!accountId) return;
    setBusy(true);
    const { error: err } = await createClient()
      .from("lulu_campaigns")
      .upsert(
        DEFAULT_CAMPAIGN_ROWS.map((r) => ({ ...r, rule_params: { ...r.rule_params }, account_id: accountId })),
        { onConflict: "account_id,campaign_code", ignoreDuplicates: true },
      );
    setBusy(false);
    if (err) setError(err.message);
    else await load();
  };

  const toggleActive = async (c: CampaignRow) => {
    const { error: err } = await createClient().from("lulu_campaigns").update({ active: !c.active }).eq("id", c.id);
    if (err) setError(err.message);
    else await load();
  };

  const runDry = async () => {
    setBusy(true);
    setDryError(null);
    try {
      const res = await fetch("/api/lulu/dry-run", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Dry run failed");
      setDry(json);
    } catch (e) {
      setDry(null);
      setDryError(e instanceof Error ? e.message : "Dry run failed");
    } finally {
      setBusy(false);
    }
  };

  const hours = dry?.dataAsOf ? Math.floor((Date.now() - new Date(dry.dataAsOf).getTime()) / 3_600_000) : null;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <Link href="/engagement" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Engagement
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Campaigns</h1>
            <p className="text-sm text-muted-foreground">
              Rules that decide who to contact and why. Nothing here sends a message yet.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runDry()}
            disabled={busy || campaigns.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
            Run dry run
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {/lulu_campaigns/.test(error) ? "LuLu tables not found — run migrations 043–045 in Supabase." : error}
        </div>
      )}

      {!loading && campaigns.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-border p-6 text-sm">
          <p className="mb-3 text-muted-foreground">
            No campaigns yet. Create the five that run on order data alone: 15-day inactive, 30-day win-back, 60-day lost,
            second order, VIP protection (all off, in dry-run mode).
          </p>
          <button
            type="button"
            onClick={() => void createDefaults()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-foreground hover:bg-muted disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Create default campaigns
          </button>
        </div>
      )}

      {campaigns.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Campaign</th>
                <th className="px-4 py-2 font-medium">Priority class</th>
                <th className="px-4 py-2 font-medium">Rule</th>
                <th className="px-4 py-2 font-medium">Mode</th>
                <th className="px-4 py-2 font-medium">Live</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div className="font-medium text-foreground">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.campaign_code}</div>
                  </td>
                  <td className="px-4 py-2">{PRIORITY_CLASS_BY_TYPE[c.campaign_type] ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {Object.entries(c.rule_params ?? {}).map(([k, v]) => `${k}: ${String(v)}`).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2">{c.mode}</td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => void toggleActive(c)}
                      className={`rounded-full px-2 py-0.5 text-xs ${c.active ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}
                      title="Marks the campaign as eligible for live sending once the sender exists. Dry run ignores this."
                    >
                      {c.active ? "On" : "Off"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dryError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{dryError}</div>
      )}

      {dry && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Dry-run result — nothing was sent</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {fmt(dry.report.profiles - dry.report.suspects)} customers evaluated ({fmt(dry.report.suspects)} suspected shared
              numbers skipped). <b className="text-foreground">{fmt(dry.report.customersWithAction)}</b> would receive a message today;{" "}
              {fmt(dry.report.customersWithoutAction)} would not.
            </p>
            {hours !== null && hours > 36 && (
              <p className="mt-2 text-sm text-amber-600">
                Order data is {hours}h old — these numbers overstate inactivity. Refresh the data and re-sync first.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Lifecycle: {Object.entries(dry.report.lifecycle).map(([k, v]) => `${k} ${fmt(v)}`).join(" · ")}
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Campaign</th>
                  <th className="px-4 py-2 font-medium">Matched</th>
                  <th className="px-4 py-2 font-medium">Would send</th>
                  <th className="px-4 py-2 font-medium">Not sent, because…</th>
                </tr>
              </thead>
              <tbody>
                {dry.report.campaigns.map((c) => (
                  <tr key={c.code} className="border-t border-border align-top">
                    <td className="px-4 py-2 font-medium text-foreground">{c.name}</td>
                    <td className="px-4 py-2 tabular-nums">{fmt(c.matched)}</td>
                    <td className="px-4 py-2 font-medium tabular-nums">{fmt(c.selected)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {Object.entries(c.blocked).map(([r, n]) => `${fmt(n)} ${REASON_LABEL[r] ?? r}`).join(" · ") || "—"}
                      {c.samples.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {c.samples.map((s) => (
                            <div key={s.customerId}>
                              {s.name ?? "—"} · {s.mobile} · {s.reason}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
