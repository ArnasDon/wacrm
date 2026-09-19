"use client";

import { PasswordInput } from "@/components/ui/password-input";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, XCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Field, Panel, inputCls } from "@/components/sales/kit";

interface Status {
  connected: boolean;
  healthy?: boolean;
  error?: string | null;
  phoneNumberId?: string;
  wabaId?: string | null;
  displayPhone?: string | null;
  verifiedName?: string | null;
  hasVerifyToken?: boolean;
}

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
}

export function WhatsAppSettings() {
  const { canEditSettings } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [form, setForm] = useState({ phoneNumberId: "", wabaId: "", accessToken: "", verifyToken: "", pin: "" });
  const [saving, setSaving] = useState(false);
  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/whatsapp/webhook` : "";

  const load = () => api<Status>("/api/whatsapp/config").then(setStatus).catch((e) => toast.error(e.message));
  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const d = await api<{ warnings: string[] }>("/api/whatsapp/config", { body: form });
      toast.success("WhatsApp connected");
      d.warnings.forEach((w) => toast.warning(w));
      setForm({ phoneNumberId: "", wabaId: "", accessToken: "", verifyToken: "", pin: "" });
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect this WhatsApp number? The sales rep will stop receiving messages.")) return;
    await api("/api/whatsapp/config", { method: "DELETE" }).catch((e) => toast.error(e.message));
    void load();
  };

  return (
    <div className="space-y-4">
      <Panel title="Connection">
        {status === null ? (
          <div className="h-12 animate-pulse rounded bg-slate-800/50" />
        ) : status.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {status.healthy ? <CheckCircle2 className="size-5 text-emerald-400" /> : <XCircle className="size-5 text-red-400" />}
              <div>
                <p className="text-sm text-white">{status.verifiedName ?? "WhatsApp Business"} · {status.displayPhone}</p>
                <p className="text-xs text-slate-400">{status.healthy ? "Connected and healthy" : `Meta error: ${status.error}`}</p>
              </div>
            </div>
            {canEditSettings && <Button variant="ghost" className="text-red-300" onClick={disconnect}>Disconnect</Button>}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Not connected. Until you connect a number, use the test chat on the AI Sales Rep page.</p>
        )}
      </Panel>

      <Panel title="Webhook" description="In Meta for Developers → WhatsApp → Configuration, set this callback URL and the verify token you choose below, then subscribe to the “messages” field.">
        <div className="flex gap-2">
          <input readOnly className={inputCls} value={webhookUrl} />
          <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" onClick={() => copy(webhookUrl)}><Copy className="size-4" /></Button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Meta must reach this URL over HTTPS, so it only works once the app is deployed (or tunnelled). The server also needs META_APP_SECRET set to verify message signatures.</p>
      </Panel>

      {canEditSettings && (
        <Panel title={status?.connected ? "Update credentials" : "Connect your number"} description="From Meta for Developers → your app → WhatsApp → API Setup. Use a permanent System User token, not the 24-hour test token.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone number ID"><input className={inputCls} value={form.phoneNumberId} onChange={(e) => setForm((f) => ({ ...f, phoneNumberId: e.target.value.trim() }))} placeholder={status?.phoneNumberId ?? ""} /></Field>
            <Field label="WhatsApp Business Account ID"><input className={inputCls} value={form.wabaId} onChange={(e) => setForm((f) => ({ ...f, wabaId: e.target.value.trim() }))} placeholder={status?.wabaId ?? ""} /></Field>
            <Field label="Access token" className="sm:col-span-2"><PasswordInput autoComplete="off" className={inputCls} value={form.accessToken} onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value.trim() }))} /></Field>
            <Field label="Webhook verify token" hint="Any secret phrase — paste the same one into Meta."><input className={inputCls} value={form.verifyToken} onChange={(e) => setForm((f) => ({ ...f, verifyToken: e.target.value }))} /></Field>
            <Field label="2-step PIN (optional)" hint="6 digits, registers the number with Cloud API."><input className={inputCls} inputMode="numeric" maxLength={6} value={form.pin} onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, "") }))} /></Field>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={save} disabled={saving || !form.phoneNumberId || !form.accessToken}>{saving ? "Verifying with Meta…" : "Save & verify"}</Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
