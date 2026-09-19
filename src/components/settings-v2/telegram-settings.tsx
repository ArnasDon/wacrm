"use client";

import { PasswordInput } from "@/components/ui/password-input";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BellRing, Copy, ExternalLink, Loader2, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Panel, inputCls } from "@/components/sales/kit";

type EventKey = "orderCreated" | "orderPaid" | "proofSubmitted" | "handoff";

interface State {
  connected: boolean;
  enabled?: boolean;
  botUsername?: string;
  linkCode?: string;
  deepLink?: string;
  chats?: Array<{ chatId: string; title: string; linkedAt: string }>;
  events?: Record<EventKey, boolean>;
}

const EVENT_LABELS: Record<EventKey, string> = {
  orderCreated: "New order placed",
  orderPaid: "Payment received — sale closed",
  proofSubmitted: "Transfer screenshot waiting for review",
  handoff: "Customer asked for a person",
};

export function TelegramSettings() {
  const [s, setS] = useState<State | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api<State>("/api/settings/telegram").then(setS).catch((e) => toast.error(e.message));
  useEffect(() => {
    void load();
  }, []);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    run("connect", async () => {
      setS(await api<State>("/api/settings/telegram", { method: "PUT", body: { botToken: token } }));
      setToken("");
      toast.success("Bot connected — now link your chat");
    });

  const link = () =>
    run("link", async () => {
      const r = await api<State & { linked: string[] }>("/api/settings/telegram", { body: { action: "link" } });
      setS(r);
      if (r.linked.length) toast.success(`Linked: ${r.linked.join(", ")}`);
      else toast.message("No new chats found. Send the code to your bot first, then check again.");
    });

  const post = (body: Record<string, unknown>) => api<State>("/api/settings/telegram", { body }).then(setS);

  if (!s) return <div className="h-60 animate-pulse rounded-xl bg-slate-900/50" />;

  return (
    <div className="space-y-4">
      <Panel
        title="Telegram alerts"
        description="Get a push notification on your phone for new orders, payments and customers who need you. Each business uses its own bot, so alerts only ever reach the chats you link."
      >
        {!s.connected ? (
          <ol className="space-y-3 text-sm text-slate-300">
            <li>
              <span className="font-medium text-white">1.</span> Open{" "}
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">@BotFather <ExternalLink className="size-3" /></a>{" "}
              in Telegram, send <code className="rounded bg-slate-800 px-1">/newbot</code> and follow the steps.
            </li>
            <li>
              <span className="font-medium text-white">2.</span> Paste the token it gives you:
              <div className="mt-2 flex gap-2">
                <PasswordInput autoComplete="off" className={inputCls} placeholder="123456789:AAH…" value={token} onChange={(e) => setToken(e.target.value.trim())} />
                <Button onClick={connect} disabled={!token || busy === "connect"}>{busy === "connect" ? <Loader2 className="size-4 animate-spin" /> : "Connect bot"}</Button>
              </div>
            </li>
          </ol>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-white">
                Bot <a href={`https://t.me/${s.botUsername}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">@{s.botUsername}</a>
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <Switch checked={!!s.enabled} onCheckedChange={(v) => run("toggle", () => post({ action: "events", enabled: v }))} /> Alerts on
              </label>
            </div>

            <div className="rounded-lg border border-slate-800 p-3">
              <p className="text-sm text-white">Link a chat</p>
              <p className="mt-1 text-xs text-slate-400">
                Open your bot and press <b>Start</b> (or send the code below). For a team, add the bot to a Telegram group and send the code there. Then click “Check for new chats”.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <a href={s.deepLink} target="_blank" rel="noreferrer">
                  <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200"><Send className="size-4" /> Open bot</Button>
                </a>
                <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" onClick={() => navigator.clipboard.writeText(s.linkCode ?? "").then(() => toast.success("Code copied"))}>
                  <Copy className="size-4" /> Copy code <code className="text-[11px] text-slate-400">{s.linkCode}</code>
                </Button>
                <Button onClick={link} disabled={busy === "link"}>{busy === "link" ? <Loader2 className="size-4 animate-spin" /> : null} Check for new chats</Button>
              </div>
            </div>

            <div>
              <p className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Linked chats</p>
              {s.chats?.length ? (
                <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
                  {s.chats.map((c) => (
                    <li key={c.chatId} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-slate-200">{c.title}</span>
                      <Button size="icon-sm" variant="ghost" aria-label="Unlink" className="text-slate-400" onClick={() => run("unlink", () => post({ action: "unlink", chatId: c.chatId }))}><Trash2 /></Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">None yet.</p>
              )}
            </div>

            <div>
              <p className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Notify me about</p>
              <div className="space-y-2">
                {(Object.keys(EVENT_LABELS) as EventKey[]).map((k) => (
                  <label key={k} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm text-slate-200">
                    {EVENT_LABELS[k]}
                    <Switch checked={!!s.events?.[k]} onCheckedChange={(v) => run(k, () => post({ action: "events", event: k, enabled: v }))} />
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap justify-between gap-2 border-t border-slate-800 pt-3">
              <Button variant="ghost" className="text-red-300" onClick={() => confirm("Disconnect this bot? Linked chats are removed.") && run("delete", async () => { await api("/api/settings/telegram", { method: "DELETE" }); await load(); })}>
                Disconnect bot
              </Button>
              <Button
                variant="outline"
                className="border-slate-700 bg-slate-900 text-slate-200"
                disabled={!s.chats?.length || busy === "test"}
                onClick={() =>
                  run("test", async () => {
                    const r = await api<{ count: number }>("/api/settings/telegram", { body: { action: "test" } });
                    toast.success(`Test alert sent to ${r.count} chat${r.count === 1 ? "" : "s"}`);
                  })
                }
              >
                <BellRing className="size-4" /> Send test alert
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
