"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Field, Panel, inputCls, textareaCls } from "@/components/sales/kit";

interface Business {
  displayName: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxId: string | null;
  taxRateBps: number;
  bank: { bankName: string | null; accountName: string | null; accountNumber: string | null };
  invoiceNotes: string | null;
  receiptFooter: string | null;
  hasLogo: boolean;
  logoVersion: number;
}

export function BusinessSettings() {
  const { canEditSettings, refreshProfile } = useAuth();
  const [b, setB] = useState<Business | null>(null);
  const [taxPct, setTaxPct] = useState("0");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const d = await api<{ business: Business }>("/api/settings/business");
    setB(d.business);
    setTaxPct(String(d.business.taxRateBps / 100));
  };
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, []);

  if (!b) return <div className="h-80 animate-pulse rounded-xl bg-slate-900/50" />;
  const set = <K extends keyof Business>(k: K, v: Business[K]) => setB((cur) => (cur ? { ...cur, [k]: v } : cur));
  const setBank = (k: keyof Business["bank"], v: string) => setB((cur) => (cur ? { ...cur, bank: { ...cur.bank, [k]: v } } : cur));

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/settings/business", {
        method: "PATCH",
        body: {
          displayName: b.displayName,
          legalName: b.legalName,
          address: b.address,
          phone: b.phone,
          email: b.email,
          website: b.website,
          taxId: b.taxId,
          invoiceNotes: b.invoiceNotes,
          receiptFooter: b.receiptFooter,
          taxRatePercent: taxPct || 0,
          bank: b.bank,
        },
      });
      toast.success("Business profile saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      await api("/api/settings/business/logo", { form });
      toast.success("Logo updated");
      await load();
      void refreshProfile();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const removeLogo = async () => {
    await api("/api/settings/business/logo", { method: "DELETE" }).catch(() => {});
    await load();
    void refreshProfile();
  };

  const ro = !canEditSettings;

  return (
    <div className="space-y-4">
      <Panel title="Logo" description="Shown on invoices, receipts and in the app. PNG or JPEG, up to 512 KB. A square logo on a white or transparent background works best.">
        <div className="flex items-center gap-4">
          <div className="flex size-20 items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-white">
            {b.hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/settings/business/logo?v=${b.logoVersion}`} alt="Business logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <ImagePlus className="size-6 text-slate-400" />
            )}
          </div>
          {!ro && (
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" onClick={() => fileRef.current?.click()}>
                {b.hasLogo ? "Replace" : "Upload logo"}
              </Button>
              {b.hasLogo && (
                <Button variant="ghost" className="text-slate-400" onClick={removeLogo}><Trash2 className="size-4" /> Remove</Button>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Business details" description="Printed at the top of every invoice and receipt.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business name"><input disabled={ro} className={inputCls} value={b.displayName} onChange={(e) => set("displayName", e.target.value)} /></Field>
          <Field label="Registered name (optional)"><input disabled={ro} className={inputCls} value={b.legalName ?? ""} onChange={(e) => set("legalName", e.target.value)} /></Field>
          <Field label="Address" className="sm:col-span-2"><input disabled={ro} className={inputCls} value={b.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="12 Balogun St, Lagos Island, Lagos" /></Field>
          <Field label="Phone"><input disabled={ro} className={inputCls} value={b.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><input disabled={ro} className={inputCls} value={b.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Website / Instagram"><input disabled={ro} className={inputCls} value={b.website ?? ""} onChange={(e) => set("website", e.target.value)} /></Field>
          <Field label="TIN / RC number (optional)"><input disabled={ro} className={inputCls} value={b.taxId ?? ""} onChange={(e) => set("taxId", e.target.value)} /></Field>
          <Field label="VAT %" hint="0 for no VAT line. Nigeria standard rate is 7.5%."><input disabled={ro} className={inputCls} inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} /></Field>
        </div>
      </Panel>

      <Panel title="Bank account for transfers" description="Sent to customers with every order. When they pay by transfer and send a screenshot, you confirm it in Orders → Transfer proofs.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Bank"><input disabled={ro} className={inputCls} value={b.bank.bankName ?? ""} onChange={(e) => setBank("bankName", e.target.value)} placeholder="GTBank" /></Field>
          <Field label="Account number"><input disabled={ro} className={inputCls} inputMode="numeric" maxLength={10} value={b.bank.accountNumber ?? ""} onChange={(e) => setBank("accountNumber", e.target.value.replace(/\D/g, ""))} placeholder="0123456789" /></Field>
          <Field label="Account name"><input disabled={ro} className={inputCls} value={b.bank.accountName ?? ""} onChange={(e) => setBank("accountName", e.target.value)} /></Field>
        </div>
      </Panel>

      <Panel title="Document text">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice notes" hint="e.g. delivery terms"><textarea disabled={ro} className={textareaCls} value={b.invoiceNotes ?? ""} onChange={(e) => set("invoiceNotes", e.target.value)} /></Field>
          <Field label="Receipt footer"><textarea disabled={ro} className={textareaCls} value={b.receiptFooter ?? ""} onChange={(e) => set("receiptFooter", e.target.value)} /></Field>
        </div>
      </Panel>

      {!ro && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save business profile"}</Button>
        </div>
      )}
    </div>
  );
}
