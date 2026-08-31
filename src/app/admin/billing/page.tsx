"use client";

import { useEffect, useState } from "react";
import {
  CreditCard,
  Coins,
  Settings,
  PlusCircle,
  Loader2,
  Check,
  Building2,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

interface BillingSettings {
  default_per_message_rate: number;
  currency: string;
  credit_unit_value: number;
  recharge_mode: string;
  gateway_provider: string;
}

interface AccountItem {
  id: string;
  name: string;
  created_at: string;
}

export default function AdminBillingPage() {
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settings, setSettings] = useState<BillingSettings>({
    default_per_message_rate: 1.5,
    currency: "INR",
    credit_unit_value: 1.0,
    recharge_mode: "manual",
    gateway_provider: "razorpay",
  });

  const [accounts, setAccounts] = useState<AccountItem[]>([]);

  // Manual Recharge state
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [rechargeCredits, setRechargeCredits] = useState<number>(100);
  const [rechargeNote, setRechargeNote] = useState("");
  const [submittingRecharge, setSubmittingRecharge] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch settings
      const settingsRes = await fetch("/api/admin/billing/settings");
      if (settingsRes.ok) {
        const sData = await settingsRes.json();
        if (sData.settings) setSettings(sData.settings);
      }

      // 2. Fetch accounts list for top-up selector
      const accountsRes = await fetch("/api/admin/accounts");
      if (accountsRes.ok) {
        const aData = await accountsRes.json();
        setAccounts(aData.accounts ?? []);
        if (aData.accounts?.length > 0 && !selectedAccountId) {
          setSelectedAccountId(aData.accounts[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load admin billing data:", err);
      toast.error("Failed to load billing configuration");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch("/api/admin/billing/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (!res.ok) throw new Error("Failed to save billing settings");
      toast.success("Billing settings updated successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error saving settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleManualRecharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccountId || rechargeCredits <= 0) return;

    setSubmittingRecharge(true);
    try {
      const res = await fetch("/api/admin/billing/recharge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: selectedAccountId,
          credits: rechargeCredits,
          note: rechargeNote || "Manual admin top-up",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Recharge failed");
      }

      const data = await res.json();
      toast.success(
        `Successfully added ${rechargeCredits} credits! New balance: ${data.new_balance}`
      );
      setRechargeNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recharge failed");
    } finally {
      setSubmittingRecharge(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Billing & Credits Configuration
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">
          Set global per-message debit rates, currency, recharge modes, and perform manual credit top-ups.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Global Settings Card */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Settings className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Global Rate & Mode</h2>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Default Per-Message Rate (Credits)
              </label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={settings.default_per_message_rate}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    default_per_message_rate: parseFloat(e.target.value) || 0,
                  }))
                }
                className="text-xs sm:text-sm"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Number of credits deducted per billable outbound template message. Default: 1.50.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Currency</label>
                <Input
                  value={settings.currency}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, currency: e.target.value.toUpperCase() }))
                  }
                  className="text-xs sm:text-sm font-mono"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Credit Value ({settings.currency})</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={settings.credit_unit_value}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      credit_unit_value: parseFloat(e.target.value) || 1.0,
                    }))
                  }
                  className="text-xs sm:text-sm"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Recharge Mode</label>
              <select
                value={settings.recharge_mode}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, recharge_mode: e.target.value }))
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs sm:text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="manual">Manual Admin Top-up Only</option>
                <option value="gateway">Payment Gateway Only (Razorpay)</option>
                <option value="both">Both Manual & Payment Gateway</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="inline-flex items-center justify-center gap-2 w-full rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save Global Settings
            </button>
          </form>
        </div>

        {/* Manual Top-Up Card */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <PlusCircle className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-foreground">Manual Credit Top-Up</h2>
          </div>

          <form onSubmit={handleManualRecharge} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Target Account</label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs sm:text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.id.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Credits to Add</label>
              <Input
                type="number"
                min="1"
                step="1"
                value={rechargeCredits}
                onChange={(e) => setRechargeCredits(parseInt(e.target.value) || 0)}
                className="text-xs sm:text-sm"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Note / Reference</label>
              <Input
                value={rechargeNote}
                onChange={(e) => setRechargeNote(e.target.value)}
                placeholder="e.g. Bank transfer / Offline payment ref #1234"
                className="text-xs sm:text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={submittingRecharge || !selectedAccountId}
              className="inline-flex items-center justify-center gap-2 w-full rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {submittingRecharge ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
              Credit Account Wallet
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
