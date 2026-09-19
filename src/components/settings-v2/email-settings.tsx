"use client";

import { PasswordInput } from "@/components/ui/password-input";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Mail, Plus, Star, Trash2, XCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, Field, Panel, inputCls } from "@/components/sales/kit";

interface Account {
  id: string;
  provider: "smtp" | "gmail";
  label: string;
  fromName: string | null;
  fromEmail: string;
  isDefault: boolean;
  smtp: { host: string; port: number } | null;
  lastTestOk: boolean | null;
}

const PRESETS: Record<string, { host: string; port: number; hint: string }> = {
  gmail: { host: "smtp.gmail.com", port: 465, hint: "Use a Google App Password (Google Account → Security → 2-Step Verification → App passwords), not your normal password." },
  outlook: { host: "smtp.office365.com", port: 587, hint: "Microsoft 365 / Outlook.com." },
  zoho: { host: "smtp.zoho.com", port: 465, hint: "Zoho Mail." },
  other: { host: "", port: 465, hint: "Your hosting provider's SMTP details (cPanel mail, Namecheap, etc.)." },
};

export function EmailSettings() {
  const { profile } = useAuth();
  const params = useSearchParams();
  const [data, setData] = useState<{ accounts: Account[]; gmailOAuthAvailable: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState("gmail");
  const [form, setForm] = useState({ fromName: "", fromEmail: "", username: "", password: "", host: "smtp.gmail.com", port: "465" });
  const [saving, setSaving] = useState(false);

  const load = () => api<{ accounts: Account[]; gmailOAuthAvailable: boolean }>("/api/settings/email").then(setData).catch((e) => toast.error(e.message));
  useEffect(() => {
    void load();
    const g = params.get("gmail");
    if (g === "connected") toast.success("Gmail connected");
    else if (g) toast.error(g === "scope" ? "Gmail permission to send wasn't granted" : "Gmail connection failed");
  }, [params]);

  const add = async () => {
    setSaving(true);
    try {
      await api("/api/settings/email", { body: { ...form, username: form.username || form.fromEmail, port: Number(form.port) } });
      toast.success("Mailbox added — send a test to check it");
      setAdding(false);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const test = async (a: Account) => {
    const to = prompt("Send a test email to:", profile?.email ?? "");
    if (!to) return;
    try {
      const r = await api<{ ok: boolean; message: string }>(`/api/settings/email/${a.id}`, { body: { to } });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Email"
        description="Invoices and receipts are emailed from your own address when the customer has an email."
        actions={
          <div className="flex gap-2">
            {data?.gmailOAuthAvailable && (
              <a href="/api/integrations/gmail/connect">
                <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200"><Mail className="size-4" /> Connect Gmail</Button>
              </a>
            )}
            <Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add mailbox (SMTP)</Button>
          </div>
        }
      >
        {data === null ? (
          <div className="h-20 animate-pulse rounded bg-slate-800/40" />
        ) : data.accounts.length === 0 ? (
          <EmptyState icon={<Mail className="size-6" />} title="No mailbox linked" body={data.gmailOAuthAvailable ? "Connect Gmail in one click, or add any mailbox by SMTP." : "Add your Gmail (with an App Password), Google Workspace, Outlook or hosting mailbox via SMTP."} />
        ) : (
          <ul className="divide-y divide-slate-800">
            {data.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm text-white">
                    {a.fromName ? `${a.fromName} <${a.fromEmail}>` : a.fromEmail}
                    {a.isDefault ? <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 text-[10px] text-primary">sends receipts</span> : null}
                    {a.lastTestOk === true ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : a.lastTestOk === false ? <XCircle className="size-3.5 text-red-400" /> : null}
                  </p>
                  <p className="text-xs text-slate-500">{a.provider === "gmail" ? "Gmail (Google sign-in)" : `SMTP · ${a.smtp?.host}:${a.smtp?.port}`}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" onClick={() => test(a)}>Send test</Button>
                  {!a.isDefault && <Button size="icon-sm" variant="ghost" aria-label="Use for receipts" className="text-slate-400" onClick={() => api(`/api/settings/email/${a.id}`, { method: "PATCH", body: {} }).then(load)}><Star /></Button>}
                  <Button size="icon-sm" variant="ghost" aria-label="Remove" className="text-slate-400" onClick={() => confirm("Remove this mailbox?") && api(`/api/settings/email/${a.id}`, { method: "DELETE" }).then(load)}><Trash2 /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && !data.gmailOAuthAvailable && (
          <p className="mt-3 text-[11px] text-slate-500">One-click “Connect Gmail” appears when the server has GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET set (Google Cloud OAuth client with the gmail.send scope).</p>
        )}
      </Panel>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="border border-slate-800 bg-slate-900 text-slate-100 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">Add a mailbox</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-wrap gap-1.5 sm:col-span-2">
              {Object.keys(PRESETS).map((k) => (
                <button
                  key={k}
                  onClick={() => { setPreset(k); setForm((f) => ({ ...f, host: PRESETS[k].host, port: String(PRESETS[k].port) })); }}
                  className={`rounded-full border px-2.5 py-1 text-xs capitalize ${preset === k ? "border-primary text-primary" : "border-slate-700 text-slate-400"}`}
                >
                  {k}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 sm:col-span-2">{PRESETS[preset].hint}</p>
            <Field label="From name"><input className={inputCls} value={form.fromName} onChange={(e) => setForm((f) => ({ ...f, fromName: e.target.value }))} placeholder="Ada's Fabrics" /></Field>
            <Field label="Email address"><input className={inputCls} value={form.fromEmail} onChange={(e) => setForm((f) => ({ ...f, fromEmail: e.target.value.trim() }))} /></Field>
            <Field label="SMTP host"><input className={inputCls} value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value.trim() }))} /></Field>
            <Field label="Port"><input className={inputCls} value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))} /></Field>
            <Field label="Username" hint="Usually the email address"><input className={inputCls} value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.trim() }))} placeholder={form.fromEmail} /></Field>
            <Field label="Password / App password"><PasswordInput autoComplete="off" className={inputCls} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} /></Field>
          </div>
          <DialogFooter className="border-slate-800 bg-slate-900">
            <Button variant="ghost" className="text-slate-300" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={add} disabled={saving || !form.fromEmail || !form.password || !form.host}>{saving ? "Saving…" : "Add mailbox"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
