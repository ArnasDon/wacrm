"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, Bot, Check, CheckCheck, FileText, Hand, ImageIcon, MessageSquare, Mic, Search, SendHorizonal } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { EmptyState, Money, StatusPill, inputCls, orderDisplayStatus, timeAgo } from "@/components/sales/kit";

interface Contact { _id: string; name: string | null; phone: string; email: string | null; isSandbox?: boolean }
interface Conversation {
  _id: string;
  contactId: string;
  status: "open" | "closed";
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
  aiPaused: boolean;
  aiPausedReason: string | null;
  contact: Contact | null;
}
interface Msg {
  _id: string;
  direction: "inbound" | "outbound";
  sender: string;
  type: string;
  transcribed?: boolean;
  text: string | null;
  media: { id: string | null; mime: string | null; filename: string | null; href?: string | null } | null;
  status: string;
  error: string | null;
  createdAt: string;
}
interface Thread {
  conversation: Conversation;
  contact: Contact | null;
  messages: Msg[];
  orders: Array<{ _id: string; number: string; status: string; total: number; currency: string; payment: { status: string }; createdAt: string }>;
}

function name(c: Contact | null) {
  return c?.name ?? (c ? `+${c.phone}` : "Unknown");
}

function StatusTick({ status }: { status: string }) {
  if (status === "failed") return <AlertCircle className="size-3 text-red-300" />;
  if (status === "read") return <CheckCheck className="size-3 text-sky-300" />;
  if (status === "delivered") return <CheckCheck className="size-3" />;
  return <Check className="size-3" />;
}

function ThreadView({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const { canSendMessages } = useAuth();
  const [t, setT] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setT(await api<Thread>(`/api/conversations/${id}`));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    setT(null);
    void load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [load]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [t?.messages.length]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api("/api/whatsapp/send", { body: { conversationId: id, text } });
      setText("");
      await load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const toggleAI = async () => {
    if (!t) return;
    try {
      await api(`/api/conversations/${id}`, { method: "PATCH", body: { aiPaused: !t.conversation.aiPaused } });
      toast.success(t.conversation.aiPaused ? "Sales rep resumed on this chat" : "You've taken over — the sales rep is paused here");
      void load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!t) return <div className="h-full animate-pulse bg-slate-900/40" />;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-800 px-3 py-2.5">
          <Button size="icon-sm" variant="ghost" className="text-slate-300 lg:hidden" onClick={onBack} aria-label="Back"><ArrowLeft /></Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{name(t.contact)}</p>
            <p className="truncate text-[11px] text-slate-500">+{t.contact?.phone}{t.contact?.isSandbox ? " · test customer" : ""}</p>
          </div>
          {canSendMessages && (
            <Button size="sm" variant={t.conversation.aiPaused ? "default" : "outline"} className={t.conversation.aiPaused ? "" : "border-slate-700 bg-slate-900 text-slate-200"} onClick={toggleAI}>
              {t.conversation.aiPaused ? <><Bot className="size-3.5" /> Hand back to AI</> : <><Hand className="size-3.5" /> Take over</>}
            </Button>
          )}
        </header>
        {t.conversation.aiPaused && (
          <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-1.5 text-[11px] text-amber-200">
            Sales rep paused{t.conversation.aiPausedReason ? ` — ${t.conversation.aiPausedReason}` : ""}. You&apos;re replying manually.
          </div>
        )}
        <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-4">
          {t.messages.map((m) => {
            const out = m.direction === "outbound";
            return (
              <div key={m._id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-lg px-3 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap ${out ? (m.sender === "agent" ? "bg-primary/20 text-white" : "bg-slate-800 text-slate-100") : "bg-slate-900 text-slate-100 ring-1 ring-slate-800"}`}>
                  {m.type === "document" && m.media ? (
                    <a href={m.media.href ?? (m.media.id ? `/api/whatsapp/media/${m.media.id}` : "#")} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded bg-black/20 px-2 py-1.5 text-xs">
                      <FileText className="size-4 text-red-300" /> {m.media.filename ?? "Document"}
                    </a>
                  ) : null}
                  {m.type === "image" && m.media ? (
                    m.media.href && !m.media.id ? (
                      <a href={m.media.href} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.media.href} alt="" className="mb-1 max-h-60 rounded" />
                      </a>
                    ) : m.media.id ? (
                      <a href={`/api/whatsapp/media/${m.media.id}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/whatsapp/media/${m.media.id}`} alt="" className="mb-1 max-h-60 rounded" />
                      </a>
                    ) : (
                      <span className="mb-1 flex items-center gap-1 text-xs text-slate-400"><ImageIcon className="size-3.5" /> {m.media.filename ?? "Image"}</span>
                    )
                  ) : null}
                  {(m.type === "audio" || m.transcribed) && m.media?.id ? (
                    <a
                      href={`/api/whatsapp/media/${m.media.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mb-1 flex items-center gap-2 rounded bg-black/20 px-2 py-1.5 text-xs"
                    >
                      <Mic className="size-3.5 text-primary" /> Voice note{m.transcribed ? " — transcribed" : ""}
                    </a>
                  ) : null}
                  {m.text}
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                    {out && m.sender !== "agent" ? <span>{m.sender === "ai" ? "AI rep" : "auto"}</span> : null}
                    <span>{new Date(m.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                    {out ? <StatusTick status={m.status} /> : null}
                  </div>
                  {m.status === "failed" && m.error ? <p className="mt-0.5 text-[10px] text-red-300">{m.error}</p> : null}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
        {canSendMessages ? (
          <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2 border-t border-slate-800 p-3">
            <textarea
              rows={1}
              className={`${inputCls} h-auto min-h-9 resize-none py-2`}
              placeholder="Reply…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button type="submit" size="icon-lg" disabled={sending || !text.trim()} aria-label="Send"><SendHorizonal /></Button>
          </form>
        ) : (
          <p className="border-t border-slate-800 p-3 text-center text-xs text-slate-500">Viewers can read conversations but not reply.</p>
        )}
      </div>
      <aside className="hidden w-64 shrink-0 space-y-3 overflow-y-auto border-l border-slate-800 p-3 xl:block">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Customer</p>
          <p className="mt-1 text-sm text-white">{name(t.contact)}</p>
          <p className="text-xs text-slate-400">+{t.contact?.phone}</p>
          {t.contact?.email ? <p className="text-xs text-slate-400">{t.contact.email}</p> : null}
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Orders</p>
          {t.orders.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500">No orders yet.</p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {t.orders.map((o) => (
                <li key={o._id}>
                  <Link href={`/orders?id=${o._id}`} className="block rounded-lg border border-slate-800 px-2.5 py-2 hover:border-slate-700">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-white">{o.number}</span>
                      <Money minor={o.total} currency={o.currency} className="text-slate-300" />
                    </div>
                    <div className="mt-1"><StatusPill status={orderDisplayStatus(o)} /></div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function InboxInner() {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("c");
  const needsHuman = params.get("filter") === "needs-human";
  const [list, setList] = useState<Conversation[] | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ conversations: Conversation[] }>(`/api/conversations?q=${encodeURIComponent(q)}`);
      setList(d.conversations);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [q]);
  useEffect(() => {
    queueMicrotask(() => void load());
    const i = setInterval(load, 12_000);
    return () => clearInterval(i);
  }, [load]);

  const shown = (list ?? []).filter((c) => !needsHuman || c.aiPaused);

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] overflow-hidden sm:-m-6">
      <div className={`flex w-full flex-col border-r border-slate-800 lg:w-80 lg:shrink-0 ${active ? "hidden lg:flex" : "flex"}`}>
        <div className="space-y-2 border-b border-slate-800 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
            <input className={`${inputCls} pl-9`} placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex gap-1 text-xs">
            <button onClick={() => router.replace("/inbox")} className={`rounded-full px-2.5 py-1 ${!needsHuman ? "bg-slate-800 text-white" : "text-slate-400"}`}>All</button>
            <button onClick={() => router.replace("/inbox?filter=needs-human")} className={`rounded-full px-2.5 py-1 ${needsHuman ? "bg-slate-800 text-white" : "text-slate-400"}`}>Needs a person</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list === null ? (
            <div className="h-40 animate-pulse" />
          ) : shown.length === 0 ? (
            <EmptyState icon={<MessageSquare className="size-6" />} title="No conversations" body="Customer chats from your WhatsApp number appear here. Connect it in Settings → WhatsApp." />
          ) : (
            shown.map((c) => (
              <button
                key={c._id}
                onClick={() => router.replace(`/inbox?c=${c._id}${needsHuman ? "&filter=needs-human" : ""}`)}
                className={`flex w-full items-start gap-3 border-b border-slate-800/60 px-3 py-2.5 text-left transition-colors ${active === c._id ? "bg-slate-800/60" : "hover:bg-slate-900"}`}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm font-medium text-slate-200">
                  {name(c.contact).replace("+", "").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${c.unreadCount ? "font-semibold text-white" : "text-slate-200"}`}>{name(c.contact)}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-500">{c.lastMessagePreview ?? "—"}</span>
                    {c.aiPaused ? <Hand className="size-3 shrink-0 text-amber-300" aria-label="Needs a person" /> : null}
                    {c.unreadCount > 0 ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{c.unreadCount}</span> : null}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
      <div className={`min-w-0 flex-1 ${active ? "block" : "hidden lg:block"}`}>
        {active ? (
          <ThreadView id={active} onBack={() => router.replace("/inbox")} onChanged={load} />
        ) : (
          <EmptyState icon={<MessageSquare className="size-6" />} title="Select a conversation" body="The AI sales rep handles chats automatically. Step in anytime with “Take over”." />
        )}
      </div>
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={null}>
      <InboxInner />
    </Suspense>
  );
}
