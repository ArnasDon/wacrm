"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bot, FileText, ImageUp, Loader2, RotateCcw, SendHorizonal, Sparkles } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, Money, NativeSelect, PageHeader, Panel, StatusPill, inputCls, orderDisplayStatus, textareaCls } from "@/components/sales/kit";

interface SalesAgent {
  name: string;
  enabled: boolean;
  mode: "ai" | "rules";
  aiProviderId: string | null;
  instructions: string;
  greeting: string;
  priceListKeywords: string[];
  handoffKeywords: string[];
  paymentProvider: "paystack" | "flutterwave" | "bank_transfer";
  autoSendPaymentLink: boolean;
  deliveryFee: number;
  approvalThreshold: number;
}

interface Provider { id: string; label: string; model: string; lastTestOk: boolean | null }

interface Msg {
  _id: string;
  direction: "inbound" | "outbound";
  sender: string;
  type: string;
  text: string | null;
  media: { filename: string | null; href?: string | null } | null;
  status: string;
  error: string | null;
  createdAt: string;
}

interface PlaygroundState {
  conversation: { aiPaused: boolean; aiPausedReason: string | null } | null;
  messages: Msg[];
  orders: Array<{ _id: string; number: string; status: string; total: number; currency: string; payment: { status: string } }>;
}

/** Render WhatsApp *bold* and _italic_ safely (text nodes only, no HTML injection). */
function WaText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_|https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>;
        if (/^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
        if (/^https?:\/\//.test(p))
          return (
            <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-sky-300 underline">
              {p}
            </a>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function Playground({ enabled, agentName }: { enabled: boolean; agentName: string }) {
  const [state, setState] = useState<PlaygroundState | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setState(await api<PlaygroundState>("/api/playground"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    // Block body: newer browsers return a Promise from scrollIntoView,
    // which React would treat as an (invalid) cleanup value.
    endRef.current?.scrollIntoView({ block: "end" });
  }, [state?.messages.length]);

  const send = async (body: Record<string, unknown>) => {
    setSending(true);
    try {
      setState(await api<PlaygroundState>("/api/playground", { body }));
      setText("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const reset = async () => {
    await api("/api/playground", { method: "DELETE" }).catch(() => {});
    void load();
  };

  const suggestions = ["Hi, what do you sell?", "price list", "Send me a picture", "I want 2 of them", "I want to speak to a person"];
  const openOrder = state?.orders.find((o) => o.status === "awaiting_payment");

  return (
    <div className="flex h-[640px] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#0b141a]">
      <div className="flex items-center gap-3 border-b border-slate-800 bg-[#202c33] px-4 py-2.5">
        <div className="flex size-9 items-center justify-center rounded-full bg-primary/20 text-primary"><Bot className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">{agentName || "Sales rep"} · test chat</p>
          <p className="text-[11px] text-slate-400">
            You are the customer · {state?.conversation?.aiPaused ? `AI paused — ${state.conversation.aiPausedReason}` : enabled ? "sales rep replies instantly" : "sales rep is OFF"}
          </p>
        </div>
        <Button size="sm" variant="ghost" className="text-slate-300" onClick={reset}><RotateCcw className="size-3.5" /> Reset</Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
        {state?.messages.length === 0 && (
          <div className="mx-auto mt-10 max-w-xs rounded-lg bg-[#182229] p-3 text-center text-xs text-slate-400">
            Send a message as if you were a customer on WhatsApp. Orders, payment links, invoices and receipts are created for real in this workspace — nothing is sent to WhatsApp.
          </div>
        )}
        {state?.messages.map((m) => {
          const mine = m.direction === "inbound";
          return (
            <div key={m._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap shadow-sm ${mine ? "rounded-tr-none bg-[#005c4b] text-white" : "rounded-tl-none bg-[#202c33] text-slate-100"}`}>
                {m.type === "document" && m.media ? (
                  <a href={m.media.href ?? "#"} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-md bg-black/20 px-2 py-2 text-xs hover:bg-black/30">
                    <FileText className="size-5 text-red-300" />
                    <span className="truncate">{m.media.filename}</span>
                  </a>
                ) : null}
                {m.type === "image" && !mine && m.media?.href ? (
                  <a href={m.media.href} target="_blank" rel="noreferrer" className="-mx-1.5 -mt-0.5 mb-1 block overflow-hidden rounded-md">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.media.href} alt="" className="max-h-64 w-full object-cover" />
                  </a>
                ) : null}
                {m.type === "image" && mine ? (
                  <div className="mb-1 flex items-center gap-2 rounded-md bg-black/20 px-2 py-2 text-xs"><ImageUp className="size-4" /> {m.media?.filename ?? "image"}</div>
                ) : null}
                {m.text ? <WaText text={m.text} /> : null}
                <div className="mt-0.5 flex justify-end gap-1 text-[10px] text-slate-300/60">
                  {!mine && m.sender === "ai" ? <span>AI</span> : null}
                  {!mine && m.sender === "system" ? <span>auto</span> : null}
                  <span>{new Date(m.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
            </div>
          );
        })}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-lg rounded-tl-none bg-[#202c33] px-3 py-2 text-slate-400"><Loader2 className="size-4 animate-spin" /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-800 bg-[#202c33] p-2">
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {suggestions.map((s) => (
            <button key={s} disabled={sending} onClick={() => send({ text: s })} className="shrink-0 rounded-full border border-slate-600 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-700">
              {s}
            </button>
          ))}
          {openOrder && (
            <button disabled={sending} onClick={() => send({ sendProof: true })} className="shrink-0 rounded-full border border-sky-500/50 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-200 hover:bg-sky-500/20">
              📎 Send transfer screenshot
            </button>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void send({ text });
          }}
          className="flex gap-2"
        >
          <input className="h-10 flex-1 rounded-full border-0 bg-[#2a3942] px-4 text-sm text-white placeholder:text-slate-400 outline-none" placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)} disabled={sending} />
          <Button type="submit" size="icon-lg" className="rounded-full" disabled={sending || !text.trim()} aria-label="Send"><SendHorizonal /></Button>
        </form>
      </div>

      {state && state.orders.length > 0 && (
        <div className="border-t border-slate-800 bg-slate-950 px-3 py-2 text-xs">
          {state.orders.slice(0, 3).map((o) => (
            <Link key={o._id} href={`/orders?id=${o._id}`} className="flex items-center justify-between py-0.5 text-slate-300 hover:text-white">
              <span>{o.number}</span>
              <span className="flex items-center gap-2"><StatusPill status={orderDisplayStatus(o)} /><Money minor={o.total} currency={o.currency} /></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SalesRepPage() {
  const { canEditSettings } = useAuth();
  const [s, setS] = useState<SalesAgent | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [money, setMoney] = useState({ deliveryFee: "", approvalThreshold: "" });

  useEffect(() => {
    api<{ salesAgent: SalesAgent }>("/api/settings/sales-agent")
      .then((d) => {
        setS(d.salesAgent);
        setMoney({ deliveryFee: String(d.salesAgent.deliveryFee / 100), approvalThreshold: String(d.salesAgent.approvalThreshold / 100) });
      })
      .catch((e) => toast.error(e.message));
    if (canEditSettings) api<{ providers: Provider[] }>("/api/settings/ai-providers").then((d) => setProviders(d.providers)).catch(() => {});
  }, [canEditSettings]);

  const upd = <K extends keyof SalesAgent>(k: K, v: SalesAgent[K]) => {
    setS((cur) => (cur ? { ...cur, [k]: v } : cur));
    setDirty(true);
  };

  const save = async (patch?: Partial<SalesAgent>) => {
    if (!s) return;
    setSaving(true);
    try {
      const body = patch ?? {
        ...s,
        deliveryFee: money.deliveryFee || 0,
        approvalThreshold: money.approvalThreshold || 0,
      };
      const d = await api<{ salesAgent: SalesAgent }>("/api/settings/sales-agent", { method: "PATCH", body });
      setS(d.salesAgent);
      setDirty(false);
      toast.success("Sales rep updated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!canEditSettings) {
    return <p className="text-sm text-slate-400">Only admins can configure the sales rep.</p>;
  }
  if (!s) return <div className="h-96 animate-pulse rounded-xl bg-slate-900/50" />;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="AI Sales Rep"
        description="Answers customers on WhatsApp, quotes from your inventory, takes orders and sends payment links, invoices and receipts."
        actions={
          <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200">
            <Switch checked={s.enabled} onCheckedChange={(v) => { upd("enabled", v); void save({ enabled: v }); }} />
            {s.enabled ? "On" : "Off"}
          </label>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          <Panel title="Brain" description="AI understands free-form chat. Rules mode works with no AI key: price-list keywords + order detection like “2 ankara, 1 head tie”.">
            <div className="grid gap-3 sm:grid-cols-2">
              {(["ai", "rules"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => upd("mode", m)}
                  className={`rounded-lg border p-3 text-left transition-colors ${s.mode === m ? "border-primary bg-primary/5" : "border-slate-800 hover:border-slate-700"}`}
                >
                  <p className="flex items-center gap-1.5 text-sm font-medium text-white">
                    {m === "ai" ? <Sparkles className="size-4 text-primary" /> : <Bot className="size-4 text-slate-400" />}
                    {m === "ai" ? "AI sales rep" : "Rules only"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{m === "ai" ? "Uses one of your AI providers. Falls back to rules if the AI is unreachable." : "Free. Predictable. Replies only to price requests and clear orders."}</p>
                </button>
              ))}
            </div>
            {s.mode === "ai" && (
              <div className="mt-3">
                {providers.length === 0 ? (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                    No AI provider yet. <Link href="/settings?tab=ai" className="underline">Add an API key</Link> (Claude, OpenAI, Gemini, Kimi, NVIDIA, Groq, or free local models via Ollama).
                  </p>
                ) : (
                  <Field label="AI provider">
                    <NativeSelect
                      value={s.aiProviderId ?? ""}
                      onChange={(v) => upd("aiProviderId", v || null)}
                      options={[{ value: "", label: "Choose…" }, ...providers.map((p) => ({ value: p.id, label: `${p.label} · ${p.model}${p.lastTestOk === false ? " (last test failed)" : ""}` }))]}
                    />
                  </Field>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Personality">
            <div className="grid gap-3">
              <Field label="Name" hint="Your rep introduces itself with this name, e.g. “Hi, I'm Amaka from Ada's Fabrics”. Use {name} and {business} in the texts below to insert it.">
                <input className={inputCls} maxLength={40} value={s.name} onChange={(e) => upd("name", e.target.value)} placeholder="Amaka" />
              </Field>
              <Field label="Instructions" hint="Tone, what to say about delivery, opening hours, return policy… The rep never invents prices — those always come from Inventory.">
                <textarea className={`${textareaCls} min-h-[140px]`} value={s.instructions} onChange={(e) => upd("instructions", e.target.value)} />
              </Field>
              <Field label="First-message greeting (rules mode)" hint="{name} and {business} are filled in automatically.">
                <input className={inputCls} value={s.greeting} onChange={(e) => upd("greeting", e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Price-list keywords" hint="Comma-separated">
                  <input className={inputCls} value={s.priceListKeywords.join(", ")} onChange={(e) => upd("priceListKeywords", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
                </Field>
                <Field label="Hand-off keywords" hint="Pause the rep and alert your team">
                  <input className={inputCls} value={s.handoffKeywords.join(", ")} onChange={(e) => upd("handoffKeywords", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
                </Field>
              </div>
            </div>
          </Panel>

          <Panel title="Checkout">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="How customers pay" hint="Bank transfer uses the account in Settings → Business; customers send a screenshot and you confirm.">
                <NativeSelect
                  value={s.paymentProvider}
                  onChange={(v) => upd("paymentProvider", v as SalesAgent["paymentProvider"])}
                  options={[
                    { value: "paystack", label: "Paystack payment link" },
                    { value: "flutterwave", label: "Flutterwave payment link" },
                    { value: "bank_transfer", label: "Bank transfer + proof of payment" },
                  ]}
                />
              </Field>
              <div className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2">
                <div>
                  <p className="text-sm text-slate-200">Send payment link automatically</p>
                  <p className="text-[11px] text-slate-500">Bank details are always included if set.</p>
                </div>
                <Switch checked={s.autoSendPaymentLink} onCheckedChange={(v) => upd("autoSendPaymentLink", v)} />
              </div>
              <Field label="Delivery fee added to orders (₦)">
                <input className={inputCls} inputMode="decimal" value={money.deliveryFee} onChange={(e) => { setMoney((m) => ({ ...m, deliveryFee: e.target.value })); setDirty(true); }} />
              </Field>
              <Field label="Orders above this need your approval (₦)" hint="0 = never. Big orders wait for a human before payment.">
                <input className={inputCls} inputMode="decimal" value={money.approvalThreshold} onChange={(e) => { setMoney((m) => ({ ...m, approvalThreshold: e.target.value })); setDirty(true); }} />
              </Field>
            </div>
          </Panel>

          <div className="sticky bottom-0 flex justify-end gap-2 bg-gradient-to-t from-slate-950 via-slate-950 pt-3 pb-1">
            <Button onClick={() => save()} disabled={saving || !dirty}>{saving ? "Saving…" : dirty ? "Save changes" : "Saved"}</Button>
          </div>
        </div>

        <div className="lg:sticky lg:top-0 lg:self-start">
          <Playground enabled={s.enabled} agentName={s.name} />
          {!s.enabled && <p className="mt-2 text-xs text-amber-300">Turn the sales rep on (top right) to test it.</p>}
          {dirty && <p className="mt-2 text-xs text-slate-400">Save your changes for the test chat to use them.</p>}        </div>
      </div>
    </div>
  );
}
