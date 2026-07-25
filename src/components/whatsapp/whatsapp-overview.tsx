"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  FileText,
  KeyRound,
  Loader2,
  MessageSquare,
  Settings,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export function WhatsAppOverview() {
  const supabase = createClient();
  const { accountId, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [templateCount, setTemplateCount] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    (async () => {
      try {
        if (!accountId) {
          if (!cancelled) {
            setConnected(false);
            setTemplateCount(0);
            setApprovedCount(0);
          }
          return;
        }

        const [configRes, templatesRes] = await Promise.all([
          supabase
            .from("whatsapp_config")
            .select("id, registered_at")
            .eq("account_id", accountId)
            .limit(1)
            .maybeSingle(),
          supabase
            .from("message_templates")
            .select("id, status")
            .eq("account_id", accountId),
        ]);

        if (cancelled) return;

        setConnected(Boolean(configRes.data?.id));
        const rows = templatesRes.data ?? [];
        setTemplateCount(rows.length);
        setApprovedCount(
          rows.filter((r) => (r.status || "").toUpperCase() === "APPROVED")
            .length,
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, authLoading]);

  if (loading || authLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading WhatsApp…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Settings}
          label="Connection"
          value={connected ? "Configured" : "Not set"}
          href="/whatsapp/config"
        />
        <StatCard
          icon={KeyRound}
          label="App Secret"
          value="Manage"
          href="/whatsapp/app-secret"
        />
        <StatCard
          icon={FileText}
          label="Templates"
          value={String(templateCount)}
          href="/whatsapp/templates"
        />
        <StatCard
          icon={MessageSquare}
          label="Approved"
          value={String(approvedCount)}
          href="/whatsapp/templates"
        />
      </div>

      {!connected ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-6">
          <h2 className="text-base font-semibold text-foreground">
            Connect WhatsApp Business
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your Phone Number ID, WABA ID, and access token so you can send
            messages and submit templates to Meta.
          </p>
          <Link
            href="/whatsapp/config"
            className={cn(buttonVariants(), "mt-4 inline-flex")}
          >
            Open WhatsApp Config
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">
              Ready to build templates
            </h2>
            <Badge variant="outline" className="text-xs">
              Connected
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Create Marketing or Utility message templates with text or media
            headers, then submit them to Meta for approval.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/whatsapp/templates"
              className={cn(buttonVariants(), "inline-flex")}
            >
              Manage templates
            </Link>
            <Link
              href="/whatsapp/config"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "inline-flex",
              )}
            >
              Connection settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Settings;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </Link>
  );
}
