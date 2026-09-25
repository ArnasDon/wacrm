"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Ban, Bot, Building2, ExternalLink, Loader2, MessageSquare, Search } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { PageHeader, Panel, inputCls, timeAgo } from "@/components/sales/kit";

interface Account {
  id: string;
  name: string;
  business: string;
  currency: string;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  owner: { email: string; fullName: string | null } | null;
  users: number;
  whatsapp: { connected: boolean; number: string | null };
  ai: { providers: number; mode: "ai" | "rules"; enabled: boolean };
  telegram: { connected: boolean; chats: number };
  storage: { provider: string | null };
  activity: {
    contacts: number;
    conversations: number;
    lastCustomerMessageAt: string | null;
    orders: number;
    paidRevenue: number;
  };
  usage: { runs7d: number; tokens7d: number; failures7d: number };
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
      <span className={`size-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-slate-600"}`} />
      {label}
    </span>
  );
}

export default function AdminPage() {
  const { platformAdmin, loading } = useAuth();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!platformAdmin) return;
    api<{ accounts: Account[] }>("/api/admin/accounts")
      .then((d) => setAccounts(d.accounts))
      .catch((e) => toast.error(e.message));
  }, [platformAdmin]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !accounts) return accounts ?? [];
    return accounts.filter((a) =>
      [a.name, a.business, a.owner?.email, a.whatsapp.number].some((v) => v?.toLowerCase().includes(needle)),
    );
  }, [accounts, q]);

  const totals = useMemo(() => {
    const list = accounts ?? [];
    return {
      merchants: list.length,
      live: list.filter((a) => a.whatsapp.connected && !a.suspendedAt).length,
      tokens: list.reduce((s, a) => s + a.usage.tokens7d, 0),
      runs: list.reduce((s, a) => s + a.usage.runs7d, 0),
      failing: list.filter((a) => a.usage.failures7d > 0).length,
    };
  }, [accounts]);

  const open = async (a: Account) => {
    setBusy(a.id);
    try {
      await api("/api/admin/open", { body: { accountId: a.id } });
      // A full load, so every server component re-reads the account.
      window.location.assign("/settings?tab=whatsapp");
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-900/50" />;
  if (!platformAdmin) {
    return <p className="text-sm text-slate-400">This area is for the platform operator.</p>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Merchants"
        description="Every business on the platform, what's connected for them, and what their AI is costing."
        actions={
          <Link href="/admin/usage">
            <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200">
              <Bot className="size-4" /> AI usage
            </Button>
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Merchants", value: String(totals.merchants) },
          { label: "Live on WhatsApp", value: String(totals.live) },
          { label: "AI replies, 7 days", value: totals.runs.toLocaleString() },
          { label: "Tokens, 7 days", value: totals.tokens.toLocaleString() },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs text-slate-400">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold text-white">{k.value}</p>
          </div>
        ))}
      </div>

      {totals.failing > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-200">
          <AlertTriangle className="size-4 shrink-0" />
          {totals.failing} merchant{totals.failing === 1 ? " has" : "s have"} had AI failures in the last 7 days.
        </p>
      )}

      <Panel title="All merchants">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Search by business, owner email or number"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {accounts === null ? (
          <div className="h-40 animate-pulse rounded-lg bg-slate-800/40" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400">No merchants match that.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((a) => (
              <li key={a.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-white">
                      <Building2 className="size-4 text-slate-500" />
                      {a.business}
                      {a.suspendedAt && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] text-red-300">
                          <Ban className="size-3" /> Suspended
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {a.owner?.email ?? "no owner"} · joined {timeAgo(a.createdAt)} · {a.users} user{a.users === 1 ? "" : "s"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      <Dot ok={a.whatsapp.connected} label={a.whatsapp.number ?? "WhatsApp"} />
                      <Dot ok={a.ai.providers > 0} label={`AI ${a.ai.enabled ? a.ai.mode : "off"}`} />
                      <Dot ok={a.telegram.connected} label={`Telegram${a.telegram.chats ? ` (${a.telegram.chats})` : ""}`} />
                      <Dot ok={!!a.storage.provider} label={a.storage.provider ?? "storage"} />
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="text-right text-xs text-slate-400">
                      <p className="text-white">{formatMoney(a.activity.paidRevenue, a.currency)}</p>
                      <p>
                        {a.activity.orders} order{a.activity.orders === 1 ? "" : "s"} · {a.activity.conversations} chat
                        {a.activity.conversations === 1 ? "" : "s"}
                      </p>
                      <p className={a.usage.failures7d > 0 ? "text-amber-300" : ""}>
                        {a.usage.runs7d} AI replies · {a.usage.tokens7d.toLocaleString()} tokens
                        {a.usage.failures7d > 0 ? ` · ${a.usage.failures7d} failed` : ""}
                      </p>
                      {a.activity.lastCustomerMessageAt && (
                        <p className="flex items-center justify-end gap-1">
                          <MessageSquare className="size-3" /> last message {timeAgo(a.activity.lastCustomerMessageAt)}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-slate-700 bg-slate-900 text-slate-200"
                        onClick={() => void open(a)}
                        disabled={busy === a.id}
                      >
                        {busy === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                        Open
                      </Button>
                      <Link href={`/admin/accounts/${a.id}`}>
                        <Button size="sm">Manage</Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
