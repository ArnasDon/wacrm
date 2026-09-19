"use client";

import { PasswordInput } from "@/components/ui/password-input";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, Panel, inputCls } from "@/components/sales/kit";

interface ProviderState {
  provider: "paystack" | "flutterwave";
  connected: boolean;
  enabled: boolean;
  publicKey: string | null;
  secretKeyMasked: string | null;
  hasWebhookHash: boolean;
  webhookUrl: string;
}

const META = {
  paystack: {
    name: "Paystack",
    keyHint: "Settings → API Keys & Webhooks. Starts with sk_live_ (or sk_test_ for testing).",
    webhookHint: "Paste this URL into Paystack → Settings → API Keys & Webhooks → Webhook URL. Events are verified with your secret key.",
  },
  flutterwave: {
    name: "Flutterwave",
    keyHint: "Settings → API keys. Starts with FLWSECK-.",
    webhookHint: "Paste this URL into Flutterwave → Settings → Webhooks, set a Secret hash there, and enter the same hash below.",
  },
} as const;

function ProviderCard({ p, onSaved }: { p: ProviderState; onSaved: () => void }) {
  const m = META[p.provider];
  const [secretKey, setSecretKey] = useState("");
  const [publicKey, setPublicKey] = useState(p.publicKey ?? "");
  const [hash, setHash] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      await api("/api/settings/payments", {
        method: "PUT",
        body: {
          provider: p.provider,
          ...(secretKey ? { secretKey } : {}),
          publicKey: publicKey || null,
          ...(hash ? { webhookHash: hash } : {}),
          ...extra,
        },
      });
      toast.success(`${m.name} saved`);
      setSecretKey("");
      setHash("");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Disconnect ${m.name}?`)) return;
    await api(`/api/settings/payments?provider=${p.provider}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    onSaved();
  };

  return (
    <Panel
      title={m.name}
      description={p.connected ? <span className="flex items-center gap-1 text-emerald-300"><CheckCircle2 className="size-3" /> Connected · {p.secretKeyMasked}</span> : "Not connected"}
      actions={p.connected ? (
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <Switch checked={p.enabled} onCheckedChange={(v) => save({ enabled: v })} /> Enabled
        </label>
      ) : null}
    >
      <div className="grid gap-3">
        <Field label={p.connected ? "Replace secret key" : "Secret key"} hint={m.keyHint}>
          <PasswordInput autoComplete="off" className={inputCls} value={secretKey} onChange={(e) => setSecretKey(e.target.value.trim())} />
        </Field>
        <Field label="Public key (optional)"><input className={inputCls} value={publicKey} onChange={(e) => setPublicKey(e.target.value.trim())} /></Field>
        {p.provider === "flutterwave" && (
          <Field label="Webhook secret hash" hint={p.hasWebhookHash ? "Set. Enter a new one to replace it." : "Required for automatic confirmation by webhook."}>
            <PasswordInput autoComplete="off" className={inputCls} value={hash} onChange={(e) => setHash(e.target.value)} />
          </Field>
        )}
        <Field label="Your webhook URL" hint={m.webhookHint}>
          <div className="flex gap-2">
            <input readOnly className={inputCls} value={p.webhookUrl} />
            <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" onClick={() => navigator.clipboard.writeText(p.webhookUrl).then(() => toast.success("Copied"))}><Copy className="size-4" /></Button>
          </div>
        </Field>
        <div className="flex justify-end gap-2">
          {p.connected && <Button variant="ghost" className="text-red-300" onClick={remove}>Disconnect</Button>}
          <Button onClick={() => save()} disabled={saving || (!p.connected && !secretKey)}>{saving ? "Verifying key…" : p.connected ? "Save" : `Connect ${m.name}`}</Button>
        </div>
      </div>
    </Panel>
  );
}

export function PaymentsSettings() {
  const [providers, setProviders] = useState<ProviderState[] | null>(null);
  const load = () => api<{ providers: ProviderState[] }>("/api/settings/payments").then((d) => setProviders(d.providers)).catch((e) => toast.error(e.message));
  useEffect(() => {
    void load();
  }, []);
  if (!providers) return <div className="h-80 animate-pulse rounded-xl bg-slate-900/50" />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Payments are confirmed automatically: the gateway notifies this app, the amount is re-checked with the gateway, the order is marked paid, stock is reduced and a receipt goes to the customer. Keys are encrypted and never shown again.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {providers.map((p) => <ProviderCard key={p.provider} p={p} onSaved={load} />)}
      </div>
    </div>
  );
}
