"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Bot, Boxes, FileCheck2, MessageSquare, Receipt } from "lucide-react";
import { api } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { EmptyState, Money, PageHeader, Panel, Stat, StatusPill, orderDisplayStatus, timeAgo } from "@/components/sales/kit";

interface Summary {
  currency: string;
  salesAgentEnabled: boolean;
  salesAgentMode: "ai" | "rules";
  kpis: {
    revenueToday: number;
    revenue7d: number;
    paidOrders7d: number;
    awaitingPayment: number;
    pendingProofs: number;
    unreadConversations: number;
    needsHuman: number;
  };
  series: Array<{ date: string; revenue: number; orders: number }>;
  lowStock: Array<{ _id: string; name: string; stock: number; lowStockThreshold: number }>;
  recentOrders: Array<{
    _id: string;
    number: string;
    status: string;
    total: number;
    currency: string;
    customer: { name: string | null; phone: string | null };
    createdAt: string;
    source: string;
    payment: { status: string };
  }>;
}

function RevenueChart({ series, currency }: { series: Summary["series"]; currency: string }) {
  const max = Math.max(...series.map((d) => d.revenue), 1);
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Paid revenue per day, last 14 days">
        {series.map((d) => (
          <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
            <div
              className="w-full rounded-t-[3px] bg-primary/80 transition-colors group-hover:bg-primary"
              style={{ height: `${Math.max((d.revenue / max) * 100, d.revenue > 0 ? 3 : 0.8)}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] whitespace-nowrap text-slate-200 shadow-lg group-hover:block">
              <div className="font-medium tabular-nums">{formatMoney(d.revenue, currency)}</div>
              <div className="text-slate-400">
                {d.orders} paid · {new Date(d.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-slate-500">
        <span>{new Date(series[0]?.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Summary>("/api/dashboard"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (error && !data) {
    return <EmptyState icon={<AlertTriangle className="size-6" />} title="Couldn't load the dashboard" body={error} action={<Button onClick={load}>Retry</Button>} />;
  }
  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[88px] animate-pulse rounded-xl border border-slate-800 bg-slate-900/50" />
        ))}
      </div>
    );
  }

  const k = data.kpis;
  const c = data.currency;
  const attention = [
    k.pendingProofs > 0 && { href: "/orders?tab=proofs", icon: FileCheck2, text: `${k.pendingProofs} transfer proof${k.pendingProofs === 1 ? "" : "s"} to confirm` },
    k.needsHuman > 0 && { href: "/inbox?filter=needs-human", icon: MessageSquare, text: `${k.needsHuman} customer${k.needsHuman === 1 ? "" : "s"} waiting for a person` },
    data.lowStock.length > 0 && { href: "/inventory", icon: Boxes, text: `${data.lowStock.length} product${data.lowStock.length === 1 ? "" : "s"} low on stock` },
  ].filter(Boolean) as Array<{ href: string; icon: typeof Receipt; text: string }>;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Today at a glance"
        description="Sales closed on WhatsApp, payments and stock."
        actions={
          <Link href="/sales-rep">
            <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800">
              <Bot className="size-4" />
              {data.salesAgentEnabled ? `Sales rep on · ${data.salesAgentMode === "ai" ? "AI" : "Rules"}` : "Sales rep off"}
            </Button>
          </Link>
        }
      />

      {attention.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {attention.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="flex items-center gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-200 transition-colors hover:bg-amber-500/10"
            >
              <a.icon className="size-4 shrink-0" />
              <span className="flex-1">{a.text}</span>
              <ArrowRight className="size-4" />
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue today" value={<Money minor={k.revenueToday} currency={c} />} />
        <Stat label="Revenue, last 7 days" value={<Money minor={k.revenue7d} currency={c} />} sub={`${k.paidOrders7d} paid orders`} />
        <Stat label="Awaiting payment" value={k.awaitingPayment} sub="Orders sent a payment link or bank details" />
        <Stat label="Unread chats" value={k.unreadConversations} tone={k.unreadConversations > 0 ? "attention" : "default"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Paid revenue" description="Last 14 days, Lagos time" className="lg:col-span-2">
          <RevenueChart series={data.series} currency={c} />
        </Panel>
        <Panel title="Low stock" actions={<Link href="/inventory" className="text-xs text-primary hover:underline">Inventory</Link>}>
          {data.lowStock.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">Everything is above its reorder level.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {data.lowStock.map((p) => (
                <li key={p._id} className="flex items-center justify-between py-2 text-sm">
                  <span className="truncate text-slate-200">{p.name}</span>
                  <span className={p.stock <= 0 ? "text-red-300" : "text-amber-300"}>{p.stock <= 0 ? "Sold out" : `${p.stock} left`}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Recent orders"
        className="mt-4"
        actions={<Link href="/orders" className="text-xs text-primary hover:underline">All orders</Link>}
      >
        {data.recentOrders.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-6" />}
            title="No orders yet"
            body="Orders appear here when customers buy on WhatsApp, or when you create one."
            action={<Link href="/sales-rep"><Button>Try the sales rep</Button></Link>}
          />
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <tbody className="divide-y divide-slate-800">
                {data.recentOrders.map((o) => (
                  <tr key={o._id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/orders?id=${o._id}`} className="font-medium text-white hover:underline">{o.number}</Link>
                      <div className="text-xs text-slate-500">{o.customer.name ?? (o.customer.phone ? `+${o.customer.phone}` : "Walk-in")}</div>
                    </td>
                    <td className="px-4 py-2.5"><StatusPill status={orderDisplayStatus(o)} /></td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{o.source === "ai" ? "AI rep" : o.source === "rules" ? "Auto" : "Staff"}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-white"><Money minor={o.total} currency={o.currency} /></td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-500">{timeAgo(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
