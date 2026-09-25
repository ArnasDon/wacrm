"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader, Panel, timeAgo } from "@/components/sales/kit";

interface UsageRow {
  accountId: string;
  name: string;
  days: Array<{ date: string; runs: number; tokens: number }>;
  totalRuns: number;
  totalTokens: number;
  failures: number;
  lastError: { message: string; kind: string; at: string } | null;
}

/** Bars of tokens per day — enough to spot the merchant who spiked. */
function Spark({ days }: { days: UsageRow["days"] }) {
  const max = Math.max(...days.map((d) => d.tokens), 1);
  return (
    <div className="flex h-8 items-end gap-0.5" aria-hidden>
      {days.map((d) => (
        <span
          key={d.date}
          title={`${d.date}: ${d.tokens.toLocaleString()} tokens, ${d.runs} replies`}
          className="w-1.5 rounded-sm bg-primary/70"
          style={{ height: `${Math.max(8, (d.tokens / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export default function AdminUsagePage() {
  const { platformAdmin, loading } = useAuth();
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [days, setDays] = useState(14);

  useEffect(() => {
    if (!platformAdmin) return;
    api<{ usage: UsageRow[] }>(`/api/admin/usage?days=${days}`)
      .then((d) => setRows(d.usage))
      .catch((e) => toast.error(e.message));
  }, [platformAdmin, days]);

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-900/50" />;
  if (!platformAdmin) return <p className="text-sm text-slate-400">This area is for the platform operator.</p>;

  const totalTokens = (rows ?? []).reduce((s, r) => s + r.totalTokens, 0);
  const totalRuns = (rows ?? []).reduce((s, r) => s + r.totalRuns, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="size-4" /> All merchants
      </Link>
      <PageHeader
        title="AI usage"
        description="What each merchant's sales rep is consuming. Tokens are what providers bill on; replies are what customers see."
        actions={
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
            aria-label="Period"
          >
            {[7, 14, 30, 90].map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Merchants using AI", value: String(rows?.length ?? 0) },
          { label: "AI replies", value: totalRuns.toLocaleString() },
          { label: "Tokens", value: totalTokens.toLocaleString() },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs text-slate-400">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold text-white">{k.value}</p>
          </div>
        ))}
      </div>

      <Panel title="By merchant" description="Ordered by tokens — the top of this list is what your provider bill is made of.">
        {rows === null ? (
          <div className="h-40 animate-pulse rounded-lg bg-slate-800/40" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400">No AI replies in this period.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.accountId} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/admin/accounts/${r.accountId}`} className="text-sm font-medium text-white hover:underline">
                      {r.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {r.totalRuns.toLocaleString()} replies · {r.totalTokens.toLocaleString()} tokens
                      {r.failures > 0 ? ` · ${r.failures} failed` : ""}
                    </p>
                    {r.lastError && (
                      <p className="mt-1 text-[11px] break-words text-amber-300">
                        last failure {timeAgo(r.lastError.at)}: {r.lastError.message.slice(0, 120)}
                      </p>
                    )}
                  </div>
                  <Spark days={r.days} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
