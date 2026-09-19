"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

// Shared building blocks for the sales screens. Dark slate surface,
// one accent (primary), status colours used only for status.

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-slate-800 bg-slate-900/50", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div className="min-w-0">
            {title ? <h3 className="text-sm font-semibold text-white">{title}</h3> : null}
            {description ? <p className="mt-0.5 text-xs text-slate-400">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Money({ minor, currency = "NGN", className }: { minor: number; currency?: string; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{formatMoney(minor, currency)}</span>;
}

const STATUS_STYLE: Record<string, string> = {
  draft: "border-slate-700 bg-slate-800 text-slate-300",
  awaiting_payment: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  proof_submitted: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  fulfilled: "border-emerald-500/30 bg-emerald-500/15 text-emerald-200",
  cancelled: "border-slate-800 bg-slate-900 text-slate-500",
  pending: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  rejected: "border-red-500/30 bg-red-500/10 text-red-300",
  failed: "border-red-500/30 bg-red-500/10 text-red-300",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Needs approval",
  awaiting_payment: "Awaiting payment",
  proof_submitted: "Proof to review",
  paid: "Paid",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        STATUS_STYLE[status] ?? STATUS_STYLE.draft,
      )}
    >
      {STATUS_LABEL[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

/** An order's display status: shows "Proof to review" while a transfer proof waits. */
export function orderDisplayStatus(o: { status: string; payment?: { status?: string } }): string {
  if (o.status === "awaiting_payment" && o.payment?.status === "proof_submitted") return "proof_submitted";
  return o.status;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-slate-300">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-slate-500">{hint}</span> : null}
    </label>
  );
}

export const inputCls =
  "h-9 w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

export const textareaCls =
  "min-h-[88px] w-full rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

export function NativeSelect({
  value,
  onChange,
  options,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputCls, "appearance-none pr-8", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-slate-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-slate-500">{icon}</div> : null}
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {body ? <p className="max-w-sm text-xs text-slate-500">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "attention";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        tone === "attention" ? "border-amber-500/30 bg-amber-500/5" : "border-slate-800 bg-slate-900/50",
      )}
    >
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-white tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function timeAgo(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
