"use client";

// ============================================================
// PaymentsSettings — Settings → Payments
//
// Where product payments reach this app: a provider webhook URL
// with an account-scoped signature secret. Configure the secret
// here and paste the webhook URL into your payment provider
// (Stripe / Paddle / any checkout that can POST a JSON event).
//
// When a checkout succeeds, the provider POSTs to the webhook;
// the server verifies the `X-Webhook-Signature` (HMAC-SHA256 of
// the raw body) and flips the order to Paid — which triggers the
// WhatsApp confirmation + delivery via the fulfillment layer.
//
// Mirrors the api-keys one-time-reveal contract: the plaintext
// secret comes back exactly ONCE (in the regenerate response).
// After the dialog closes, only the prefix remains.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, KeyRound, Link2, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCan } from "@/hooks/use-can";
import { useTranslations } from "next-intl";
import { SettingsPanelHead } from "./settings-panel-head";

interface PaymentsConfig {
  webhook_url: string;
  secret_prefix: string | null;
  has_secret: boolean;
  base_url_configured: boolean;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function PaymentsSettings() {
  const t = useTranslations("Settings.payments");
  const canEdit = useCan("edit-settings");

  const [config, setConfig] = useState<PaymentsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [revealed, setRevealed] = useState<{
    plaintext: string;
    secret_prefix: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/payments", { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t("loadFailed"));
        return;
      }
      setConfig((await res.json()) as PaymentsConfig);
    } catch {
      toast.error(t("networkError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRegenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/account/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t("regenerateFailed"));
        return;
      }
      const data = (await res.json()) as {
        webhook_url: string;
        secret_prefix: string;
        plaintext: string;
      };
      setRevealed({
        plaintext: data.plaintext,
        secret_prefix: data.secret_prefix,
      });
      setConfig((prev) =>
        prev
          ? { ...prev, webhook_url: data.webhook_url, secret_prefix: data.secret_prefix, has_secret: true }
          : prev,
      );
      toast.success(t("regenerated"));
    } catch {
      toast.error(t("networkError"));
    } finally {
      setGenerating(false);
    }
  }

  const handleCopyUrl = async () => {
    if (!config) return;
    toast.success((await copyText(config.webhook_url)) ? t("copied") : t("copyFailed"));
  };

  const handleCopySecret = async () => {
    if (!revealed) return;
    toast.success((await copyText(revealed.plaintext)) ? t("copied") : t("copyFailed"));
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <section>
      <SettingsPanelHead
        title={t("title")}
        description={t("desc")}
        action={
          canEdit ? (
            <Button variant="outline" onClick={() => void handleRegenerate()} disabled={generating}>
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("generating")}
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  {t("regenerate")}
                </>
              )}
            </Button>
          ) : null
        }
      />

      <div className="space-y-4">
        {/* Status card */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                config?.has_secret
                  ? "border-emerald-500/40 text-emerald-500"
                  : "border-amber-500/40 text-amber-500"
              }
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
              {config?.has_secret ? t("configured") : t("notConfigured")}
            </Badge>
            {!config?.base_url_configured ? (
              <Badge variant="outline" className="border-red-500/40 text-red-500">
                {t("baseUrlWarning")}
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t("statusHint")}</p>
        </div>

        {/* Webhook URL */}
        <div className="space-y-1.5">
          <Label htmlFor="webhook-url" className="text-sm font-medium text-foreground">
            {t("webhookUrl")}
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="webhook-url"
                readOnly
                value={config?.webhook_url ?? ""}
                className="pl-9 font-mono text-xs"
              />
            </div>
            <Button variant="outline" onClick={() => void handleCopyUrl()}>
              <Copy className="h-4 w-4" />
              {t("copy")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("webhookUrlHint")}</p>
        </div>

        {/* Webhook secret */}
        <div className="space-y-1.5">
          <Label htmlFor="webhook-secret" className="text-sm font-medium text-foreground">
            {t("secret")}
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="webhook-secret"
                readOnly
                value={config?.secret_prefix ?? t("noSecret")}
                className="pl-9 font-mono text-xs"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("secretHint")}</p>
        </div>
      </div>

      {/* One-time reveal dialog */}
      <Dialog open={!!revealed} onOpenChange={(v) => !v && setRevealed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-foreground">{t("revealTitle")}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("revealDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            <Input
              readOnly
              value={revealed?.plaintext ?? ""}
              className="flex-1 font-mono text-xs"
            />
            <Button variant="outline" size="sm" onClick={() => void handleCopySecret()}>
              <Copy className="h-3.5 w-3.5" />
              {t("copy")}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{t("revealWarning")}</p>

          <DialogFooter>
            <Button onClick={() => setRevealed(null)}>{t("done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
