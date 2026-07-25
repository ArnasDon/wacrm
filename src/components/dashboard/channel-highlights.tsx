"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Mail, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Dashboard home — equal spotlight for WhatsApp and Email so both
 * channels are obvious entry points (not just CRM quick actions).
 */
export function ChannelHighlights() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    (async () => {
      try {
        const waPromise = accountId
          ? supabase
              .from("whatsapp_config")
              .select("id")
              .eq("account_id", accountId)
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null });

        const [waRes, smtpRes] = await Promise.all([
          waPromise,
          fetch("/api/email/smtp", { credentials: "include", cache: "no-store" }),
        ]);

        if (cancelled) return;

        setWhatsappConnected(Boolean(waRes.data?.id));

        if (smtpRes.ok) {
          const smtpJson = (await smtpRes.json()) as {
            data?: { settings?: { id?: string } | null };
          };
          setEmailConfigured(Boolean(smtpJson.data?.settings?.id));
        } else {
          setEmailConfigured(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, authLoading]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Channels</h2>
        <p className="text-xs text-muted-foreground">
          WhatsApp and Email are both highlighted here — open either channel to
          continue setup or messaging.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ChannelCard
          href="/whatsapp"
          icon={Phone}
          title="WhatsApp"
          description="Connection, message templates, and App Secret."
          statusLoading={loading || authLoading}
          ready={whatsappConnected}
          readyLabel="Connected"
          setupLabel="Set up"
          setupHref="/whatsapp/config"
          accent="whatsapp"
        />
        <ChannelCard
          href="/email"
          icon={Mail}
          title="Email"
          description="SMTP, lists, templates, and campaigns."
          statusLoading={loading || authLoading}
          ready={emailConfigured}
          readyLabel="SMTP ready"
          setupLabel="Set up SMTP"
          setupHref="/email/smtp"
          accent="email"
        />
      </div>
    </div>
  );
}

function ChannelCard({
  href,
  icon: Icon,
  title,
  description,
  statusLoading,
  ready,
  readyLabel,
  setupLabel,
  setupHref,
  accent,
}: {
  href: string;
  icon: typeof Phone;
  title: string;
  description: string;
  statusLoading: boolean;
  ready: boolean;
  readyLabel: string;
  setupLabel: string;
  setupHref: string;
  accent: "whatsapp" | "email";
}) {
  const ring =
    accent === "whatsapp"
      ? "hover:border-emerald-500/40 hover:bg-emerald-500/5"
      : "hover:border-sky-500/40 hover:bg-sky-500/5";
  const iconWrap =
    accent === "whatsapp"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : "bg-sky-500/15 text-sky-700 dark:text-sky-400";

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors",
        ring,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            iconWrap,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            {statusLoading ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Badge
                variant="outline"
                className={
                  ready
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                }
              >
                {ready ? readyLabel : "Not set up"}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={href}
              className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
            >
              Open {title}
            </Link>
            {!statusLoading && !ready ? (
              <Link
                href={setupHref}
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" }),
                  "gap-1.5",
                )}
              >
                {setupLabel}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
