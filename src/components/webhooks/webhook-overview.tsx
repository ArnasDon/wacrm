"use client";

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, ArrowRight, Webhook, Zap, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WebhookOverviewProps {
  onTabChange: (tab: string) => void;
}

export function WebhookOverview({ onTabChange }: WebhookOverviewProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch('/api/webhooks/config');
        if (res.ok) {
          const data = await res.json();
          setIsConnected(data.config?.is_connected ?? false);
        }
      } catch (err) {
        console.error('Failed to load webhook connection state:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchConfig();
  }, []);

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Webhook className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Generic Webhooks</h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                Connect your account to various systems and applications effortlessly with Generic Webhooks. Utilize real-time updates to send customized WhatsApp messages to your customers.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 rounded-full border border-border bg-card-2 px-3 py-1.5 self-start sm:self-auto">
            <span className="text-xs text-muted-foreground font-medium">Last Updated:</span>
            {loading ? (
              <span className="h-2 w-12 animate-pulse rounded bg-muted" />
            ) : isConnected ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <XCircle className="h-3.5 w-3.5" />
                Not Connected
              </span>
            )}
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6">
          <h3 className="text-sm font-semibold text-foreground">What can I do?</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-foreground">Send customized template messages</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Automatically match incoming payloads to approved WhatsApp templates and inject variables like customer name or order number.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Zap className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-foreground">Trigger real-time triggers</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Set up matching rules on fields like event types or lead status to fire messages precisely when users take actions.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Guide Cards */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-sm font-semibold text-foreground">How it works</h3>
        <ol className="mt-4 grid gap-6 md:grid-cols-3">
          <li className="relative flex flex-col gap-2 pl-6 before:absolute before:left-0 before:top-0 before:flex before:h-5 before:w-5 before:items-center before:justify-center before:rounded-full before:bg-muted before:text-[10px] before:font-bold before:text-muted-foreground before:content-['1']">
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Configure settings</h4>
            <p className="text-xs text-muted-foreground">
              Provide an integration name, pick your WhatsApp number/channel, and grab your unique webhook URL.
            </p>
          </li>
          <li className="relative flex flex-col gap-2 pl-6 before:absolute before:left-0 before:top-0 before:flex before:h-5 before:w-5 before:items-center before:justify-center before:rounded-full before:bg-muted before:text-[10px] before:font-bold before:text-muted-foreground before:content-['2']">
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Capture sample payload</h4>
            <p className="text-xs text-muted-foreground">
              Trigger a test submission from HubSpot or Shopify to your webhook URL. This parses the JSON schema for easy mapping.
            </p>
          </li>
          <li className="relative flex flex-col gap-2 pl-6 before:absolute before:left-0 before:top-0 before:flex before:h-5 before:w-5 before:items-center before:justify-center before:rounded-full before:bg-muted before:text-[10px] before:font-bold before:text-muted-foreground before:content-['3']">
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Create workflows</h4>
            <p className="text-xs text-muted-foreground">
              Specify conditions, map recipient fields, and choose which templates to send with matching variables.
            </p>
          </li>
        </ol>

        <div className="mt-8 flex justify-end">
          <Button
            onClick={() => onTabChange('configuration')}
            className="bg-primary text-primary-foreground hover:bg-primary/95 flex items-center gap-2"
          >
            Get Started
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
