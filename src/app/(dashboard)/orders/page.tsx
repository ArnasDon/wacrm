"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  CreditCard,
  FileCheck2,
  FileText,
  Link2,
  Mail,
  PackageCheck,
  Plus,
  Receipt,
  Search,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  EmptyState,
  Field,
  Money,
  NativeSelect,
  PageHeader,
  StatusPill,
  inputCls,
  orderDisplayStatus,
  timeAgo,
} from "@/components/sales/kit";

interface Order {
  _id: string;
  number: string;
  invoiceNumber: string | null;
  receiptNumber: string | null;
  status: string;
  source: string;
  customer: { name: string | null; phone: string | null; email: string | null };
  items: Array<{ productId: string; name: string; quantity: number; unitPrice: number; lineTotal: number }>;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  tax: number;
  total: number;
  currency: string;
  notes: string | null;
  conversationId: string | null;
  payment: {
    provider: string | null;
    reference: string | null;
    link: string | null;
    status: string;
    amountPaid: number | null;
    channel: string | null;
    paidAt: string | null;
  };
  receiptSentAt: string | null;
  createdAt: string;
}

interface Proof {
  _id: string;
  orderId: string;
  status: string;
  note: string | null;
  media: { id: string | null; mime: string | null; filename: string | null } | null;
  createdAt: string;
  reviewNote: string | null;
  order?: Order | null;
}

const TABS = [
  { key: "all", label: "All" },
  { key: "awaiting_payment", label: "Awaiting payment" },
  { key: "proofs", label: "Transfer proofs" },
  { key: "draft", label: "Needs approval" },
  { key: "paid", label: "Paid" },
  { key: "fulfilled", label: "Fulfilled" },
  { key: "cancelled", label: "Cancelled" },
];

function customerLabel(o: Order) {
  return o.customer.name ?? (o.customer.phone ? `+${o.customer.phone}` : "Walk-in customer");
}

// ------------------------------------------------------------
// Proof review card (used in the drawer and the proofs tab)
// ------------------------------------------------------------

function ProofCard({ proof, order, onDone }: { proof: Proof; order: Order; onDone: () => void }) {
  const { canSendMessages } = useAuth();
  const [amount, setAmount] = useState(String(order.total / 100));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action: "approve" | "reject") => {
    setBusy(true);
    try {
      await api(`/api/payment-proofs/${proof._id}`, {
        body: action === "approve" ? { action, amount } : { action, reason: reason || null },
      });
      toast.success(action === "approve" ? "Payment confirmed — receipt sent" : "Proof rejected — customer notified");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-3">
      <div className="flex items-start gap-3">
        {proof.media?.id && proof.media.mime?.startsWith("image/") ? (
          <a href={`/api/whatsapp/media/${proof.media.id}`} target="_blank" rel="noreferrer" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/whatsapp/media/${proof.media.id}`} alt="Transfer proof" className="h-24 w-20 rounded-md border border-slate-700 object-cover" />
          </a>
        ) : (
          <div className="flex h-24 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-slate-700 bg-slate-800 text-[10px] text-slate-400">
            <FileCheck2 className="size-5" />
            {proof.media?.id ? (
              <a className="text-primary underline" href={`/api/whatsapp/media/${proof.media.id}`} target="_blank" rel="noreferrer">Open</a>
            ) : (
              "Test proof"
            )}
          </div>
        )}
        <div className="min-w-0 flex-1 text-xs">
          <div className="flex items-center gap-2">
            <StatusPill status={proof.status} />
            <span className="text-slate-500">{timeAgo(proof.createdAt)}</span>
          </div>
          {proof.note ? <p className="mt-1 text-slate-300">“{proof.note}”</p> : null}
          <p className="mt-1 text-slate-400">
            Expected <b className="text-white"><Money minor={order.total} currency={order.currency} /></b>. Check your bank app for this credit before confirming — screenshots can be faked.
          </p>
          {proof.reviewNote ? <p className="mt-1 text-slate-500">Note: {proof.reviewNote}</p> : null}
        </div>
      </div>
      {proof.status === "pending" && canSendMessages && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <Field label="Amount received (₦)">
            <input className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </Field>
          <Button className="self-end bg-emerald-600 text-white hover:bg-emerald-500" disabled={busy} onClick={() => act("approve")}>
            <CheckCircle2 className="size-4" /> Confirm payment
          </Button>
          <input className={inputCls} placeholder="Reason if rejecting (sent to customer)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="ghost" className="text-red-300 hover:bg-red-500/10" disabled={busy} onClick={() => act("reject")}>
            <XCircle className="size-4" /> Reject
          </Button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Order drawer
// ------------------------------------------------------------

function OrderDrawer({ orderId, onClose, onChanged }: { orderId: string | null; onClose: () => void; onChanged: () => void }) {
  const { canSendMessages } = useAuth();
  const [data, setData] = useState<{ order: Order; proofs: Proof[]; events: Array<{ _id: string; outcome: string; createdAt: string }> } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [paidForm, setPaidForm] = useState({ method: "bank_transfer", amount: "", note: "" });

  const load = useCallback(async () => {
    if (!orderId) return;
    try {
      setData(await api(`/api/orders/${orderId}`));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [orderId]);
  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  const act = async (action: string, body: Record<string, unknown> = {}, success?: string) => {
    if (!orderId) return;
    setBusy(action);
    try {
      await api(`/api/orders/${orderId}`, { body: { action, ...body } });
      if (success) toast.success(success);
      await load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const o = data?.order;
  const open = !!orderId;
  const unpaid = o && (o.status === "awaiting_payment" || o.status === "draft");
  const paid = o && (o.status === "paid" || o.status === "fulfilled");

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full border-slate-800 bg-slate-950 text-slate-100 sm:max-w-lg">
        <SheetHeader className="border-b border-slate-800">
          <SheetTitle className="flex items-center gap-2 text-white">
            {o ? o.number : "Order"} {o ? <StatusPill status={orderDisplayStatus(o)} /> : null}
          </SheetTitle>
          {o ? (
            <p className="text-xs text-slate-400">
              {customerLabel(o)}
              {o.customer.phone ? ` · +${o.customer.phone}` : ""}
              {o.customer.email ? ` · ${o.customer.email}` : ""} · {new Date(o.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          ) : null}
        </SheetHeader>
        {!o ? (
          <div className="m-4 h-40 animate-pulse rounded-lg bg-slate-900" />
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800">
                {o.items.map((i) => (
                  <tr key={i.productId}>
                    <td className="py-2 text-slate-200">
                      {i.quantity} × {i.name}
                      <div className="text-xs text-slate-500"><Money minor={i.unitPrice} currency={o.currency} /> each</div>
                    </td>
                    <td className="py-2 text-right text-white"><Money minor={i.lineTotal} currency={o.currency} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="space-y-1 border-t border-slate-800 pt-3 text-sm">
              {[
                ["Subtotal", o.subtotal],
                o.deliveryFee ? ["Delivery", o.deliveryFee] : null,
                o.discount ? ["Discount", -o.discount] : null,
                o.tax ? ["VAT", o.tax] : null,
              ]
                .filter(Boolean)
                .map((row) => {
                  const [label, v] = row as [string, number];
                  return (
                    <div key={label} className="flex justify-between text-slate-400">
                      <dt>{label}</dt>
                      <dd><Money minor={v} currency={o.currency} /></dd>
                    </div>
                  );
                })}
              <div className="flex justify-between pt-1 text-base font-semibold text-white">
                <dt>Total</dt>
                <dd><Money minor={o.total} currency={o.currency} /></dd>
              </div>
            </dl>

            <div className="rounded-lg border border-slate-800 p-3 text-xs text-slate-400">
              <p className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Payment</p>
              {paid ? (
                <p className="text-emerald-300">
                  Paid <Money minor={o.payment.amountPaid ?? o.total} currency={o.currency} /> via {o.payment.provider?.replace("_", " ")}
                  {o.payment.channel && o.payment.channel !== o.payment.provider ? ` (${o.payment.channel})` : ""} ·{" "}
                  {o.payment.paidAt ? new Date(o.payment.paidAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""}
                  <br />
                  <span className="text-slate-400">Receipt {o.receiptNumber} {o.receiptSentAt ? "sent" : "not sent yet"}</span>
                </p>
              ) : o.payment.link ? (
                <p>
                  {o.payment.provider === "paystack" ? "Paystack" : "Flutterwave"} link:{" "}
                  <a className="break-all text-primary underline" href={o.payment.link} target="_blank" rel="noreferrer">{o.payment.link}</a>
                </p>
              ) : (
                <p>No payment link yet — the customer was given bank details, or you can create a link below.</p>
              )}
              {o.notes ? <p className="mt-2 whitespace-pre-line text-slate-500">{o.notes}</p> : null}
            </div>

            {data.proofs.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Transfer proofs</p>
                {data.proofs.map((p) => (
                  <ProofCard key={p._id} proof={p} order={o} onDone={() => { void load(); onChanged(); }} />
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <a href={`/api/orders/${o._id}/document?kind=invoice`} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200">
                  <FileText className="size-3.5" /> Invoice PDF
                </Button>
              </a>
              {paid && (
                <a href={`/api/orders/${o._id}/document?kind=receipt`} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200">
                    <Receipt className="size-3.5" /> Receipt PDF
                  </Button>
                </a>
              )}
            </div>

            {canSendMessages && (
              <div className="space-y-2 border-t border-slate-800 pt-4">
                <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Actions</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {unpaid && (
                    <>
                      <Button disabled={!!busy} onClick={() => act("payment_link", { provider: "paystack" }, "Paystack link created")} variant="outline" className="justify-start border-slate-700 bg-slate-900 text-slate-200">
                        <Link2 className="size-4" /> Paystack link
                      </Button>
                      <Button disabled={!!busy} onClick={() => act("payment_link", { provider: "flutterwave" }, "Flutterwave link created")} variant="outline" className="justify-start border-slate-700 bg-slate-900 text-slate-200">
                        <Link2 className="size-4" /> Flutterwave link
                      </Button>
                      {o.conversationId && (
                        <Button disabled={!!busy} onClick={() => act("send_invoice", {}, "Invoice sent on WhatsApp")} variant="outline" className="justify-start border-slate-700 bg-slate-900 text-slate-200">
                          <Send className="size-4" /> Send invoice on WhatsApp
                        </Button>
                      )}
                      <Button disabled={!!busy} onClick={() => act("email_invoice", {}, "Invoice emailed")} variant="outline" className="justify-start border-slate-700 bg-slate-900 text-slate-200">
                        <Mail className="size-4" /> Email invoice
                      </Button>
                      <Button disabled={!!busy} onClick={() => { setPaidForm({ method: "bank_transfer", amount: String(o.total / 100), note: "" }); setMarkPaidOpen(true); }} className="justify-start bg-emerald-600 text-white hover:bg-emerald-500">
                        <CreditCard className="size-4" /> Mark as paid
                      </Button>
                      <Button disabled={!!busy} onClick={() => confirm("Cancel this order?") && act("cancel", {}, "Order cancelled")} variant="ghost" className="justify-start text-red-300 hover:bg-red-500/10">
                        <Ban className="size-4" /> Cancel order
                      </Button>
                    </>
                  )}
                  {o.status === "paid" && (
                    <Button disabled={!!busy} onClick={() => act("fulfill", {}, "Marked as fulfilled")} className="justify-start">
                      <PackageCheck className="size-4" /> Mark fulfilled / delivered
                    </Button>
                  )}
                  {paid && (
                    <Button disabled={!!busy} onClick={() => act("send_receipt", {}, "Receipt re-sent")} variant="outline" className="justify-start border-slate-700 bg-slate-900 text-slate-200">
                      <Send className="size-4" /> Re-send receipt
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <Dialog open={markPaidOpen} onOpenChange={setMarkPaidOpen}>
          <DialogContent className="border border-slate-800 bg-slate-900 text-slate-100">
            <DialogHeader>
              <DialogTitle className="text-white">Mark {o?.number} as paid</DialogTitle>
            </DialogHeader>
            <p className="text-xs text-slate-400">Confirm the money is in your account first. The customer gets a receipt on WhatsApp and email automatically.</p>
            <Field label="How was it paid?">
              <NativeSelect
                value={paidForm.method}
                onChange={(v) => setPaidForm((f) => ({ ...f, method: v }))}
                options={[
                  { value: "bank_transfer", label: "Bank transfer" },
                  { value: "manual", label: "Cash / POS / other" },
                ]}
              />
            </Field>
            <Field label="Amount received (₦)">
              <input className={inputCls} inputMode="decimal" value={paidForm.amount} onChange={(e) => setPaidForm((f) => ({ ...f, amount: e.target.value }))} />
            </Field>
            <Field label="Note (optional)" hint="e.g. transfer narration or teller number">
              <input className={inputCls} value={paidForm.note} onChange={(e) => setPaidForm((f) => ({ ...f, note: e.target.value }))} />
            </Field>
            <DialogFooter className="border-slate-800 bg-slate-900">
              <Button variant="ghost" className="text-slate-300" onClick={() => setMarkPaidOpen(false)}>Cancel</Button>
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-500"
                disabled={!!busy}
                onClick={async () => {
                  await act("mark_paid", { method: paidForm.method, amount: paidForm.amount, note: paidForm.note || null }, "Payment recorded — receipt sent");
                  setMarkPaidOpen(false);
                }}
              >
                Confirm payment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

// ------------------------------------------------------------
// New order
// ------------------------------------------------------------

interface ProductLite { _id: string; name: string; price: number; stock: number | null; isActive: boolean }

function NewOrderDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [lines, setLines] = useState<Array<{ productId: string; quantity: string }>>([{ productId: "", quantity: "1" }]);
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" });
  const [deliveryFee, setDeliveryFee] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLines([{ productId: "", quantity: "1" }]);
    setCustomer({ name: "", phone: "", email: "" });
    setDeliveryFee("");
    api<{ products: ProductLite[] }>("/api/products?active=true").then((d) => setProducts(d.products)).catch(() => {});
  }, [open]);

  const total = lines.reduce((s, l) => {
    const p = products.find((x) => x._id === l.productId);
    return s + (p ? p.price * (Number(l.quantity) || 0) : 0);
  }, 0) + Math.round((Number(deliveryFee) || 0) * 100);

  const save = async () => {
    setSaving(true);
    try {
      const { order } = await api<{ order: { _id: string } }>("/api/orders", {
        body: {
          items: lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
          customer: { name: customer.name || null, phone: customer.phone || null, email: customer.email || null },
          deliveryFee: deliveryFee || 0,
        },
      });
      toast.success("Order created");
      onOpenChange(false);
      onCreated(order._id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const options = [{ value: "", label: "Choose a product…" }, ...products.map((p) => ({ value: p._id, label: `${p.name} — ₦${(p.price / 100).toLocaleString()}${p.stock !== null ? ` (${p.stock} left)` : ""}` }))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-slate-800 bg-slate-900 text-slate-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">New order</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          {lines.map((l, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_72px_auto] items-end gap-2">
              <Field label={idx === 0 ? "Product" : ""}>
                <NativeSelect value={l.productId} onChange={(v) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, productId: v } : x)))} options={options} />
              </Field>
              <Field label={idx === 0 ? "Qty" : ""}>
                <input className={inputCls} inputMode="numeric" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))} />
              </Field>
              <Button size="icon" variant="ghost" aria-label="Remove line" className="text-slate-500" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" className="text-primary" onClick={() => setLines((ls) => [...ls, { productId: "", quantity: "1" }])}>
            <Plus className="size-3.5" /> Add item
          </Button>
          <div className="grid gap-3 border-t border-slate-800 pt-3 sm:grid-cols-2">
            <Field label="Customer name">
              <input className={inputCls} value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} />
            </Field>
            <Field label="WhatsApp number" hint="Receipt goes here, e.g. 0803 123 4567">
              <input className={inputCls} value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} />
            </Field>
            <Field label="Email (optional)">
              <input className={inputCls} value={customer.email} onChange={(e) => setCustomer((c) => ({ ...c, email: e.target.value }))} />
            </Field>
            <Field label="Delivery fee (₦)">
              <input className={inputCls} inputMode="decimal" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder="0" />
            </Field>
          </div>
        </div>
        <DialogFooter className="items-center border-slate-800 bg-slate-900 sm:justify-between">
          <span className="text-sm text-slate-400">Total <b className="text-white"><Money minor={total} /></b> <span className="text-[11px]">(before VAT)</span></span>
          <Button onClick={save} disabled={saving || !lines.some((l) => l.productId)}>{saving ? "Creating…" : "Create order"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

function OrdersPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { canSendMessages } = useAuth();
  const tab = params.get("tab") ?? "all";
  const openId = params.get("id");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [proofs, setProofs] = useState<Proof[] | null>(null);
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(`/orders?${next.toString()}`);
    },
    [params, router],
  );

  const load = useCallback(async () => {
    try {
      if (tab === "proofs") {
        setProofs((await api<{ proofs: Proof[] }>("/api/payment-proofs?status=pending")).proofs);
      } else {
        const qs = new URLSearchParams();
        if (tab !== "all") qs.set("status", tab);
        setOrders((await api<{ orders: Order[] }>(`/api/orders?${qs}`)).orders);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [tab]);

  useEffect(() => {
    queueMicrotask(() => {
      setOrders(null);
      setProofs(null);
      void load();
    });
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (orders ?? []).filter(
      (o) => !needle || o.number.toLowerCase().includes(needle) || customerLabel(o).toLowerCase().includes(needle) || (o.customer.phone ?? "").includes(needle),
    );
  }, [orders, q]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Orders"
        description="Every sale from WhatsApp and the counter — payments, invoices and receipts."
        actions={canSendMessages ? <Button onClick={() => setNewOpen(true)}><Plus className="size-4" /> New order</Button> : null}
      />

      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setParam("tab", t.key === "all" ? null : t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors ${tab === t.key ? "border-primary text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "proofs" ? (
        proofs === null ? (
          <div className="h-40 animate-pulse rounded-xl bg-slate-900/50" />
        ) : proofs.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50">
            <EmptyState icon={<FileCheck2 className="size-6" />} title="No transfer proofs waiting" body="When a customer sends a transfer screenshot on WhatsApp for an unpaid order, it lands here for you to confirm." />
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {proofs.map((p) =>
              p.order ? (
                <div key={p._id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
                  <button onClick={() => setParam("id", p.orderId)} className="mb-2 flex w-full items-center justify-between text-left">
                    <span className="font-medium text-white">{p.order.number} · {customerLabel(p.order)}</span>
                    <Money minor={p.order.total} currency={p.order.currency} className="text-sm text-slate-300" />
                  </button>
                  <ProofCard proof={p} order={p.order} onDone={load} />
                </div>
              ) : null,
            )}
          </div>
        )
      ) : (
        <>
          <div className="relative mb-3 w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
            <input className={`${inputCls} pl-9`} placeholder="Order number, name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
            {orders === null ? (
              <div className="h-48 animate-pulse" />
            ) : visible.length === 0 ? (
              <EmptyState icon={<Receipt className="size-6" />} title="No orders here" body="Orders the sales rep takes on WhatsApp show up automatically." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                      <th className="px-4 py-2.5 font-medium">Order</th>
                      <th className="px-4 py-2.5 font-medium">Customer</th>
                      <th className="px-4 py-2.5 font-medium">Items</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 text-right font-medium">Total</th>
                      <th className="px-4 py-2.5 text-right font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {visible.map((o) => (
                      <tr key={o._id} onClick={() => setParam("id", o._id)} className="cursor-pointer hover:bg-slate-800/30">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-white">{o.number}</div>
                          <div className="text-[11px] text-slate-500">{o.source === "ai" ? "AI sales rep" : o.source === "rules" ? "Auto-detected" : "Staff"}</div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-300">{customerLabel(o)}</td>
                        <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-slate-400">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</td>
                        <td className="px-4 py-2.5"><StatusPill status={orderDisplayStatus(o)} /></td>
                        <td className="px-4 py-2.5 text-right font-medium text-white"><Money minor={o.total} currency={o.currency} /></td>
                        <td className="px-4 py-2.5 text-right text-xs text-slate-500">{timeAgo(o.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <OrderDrawer orderId={openId} onClose={() => setParam("id", null)} onChanged={load} />
      <NewOrderDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => { void load(); setParam("id", id); }} />
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersPageInner />
    </Suspense>
  );
}
