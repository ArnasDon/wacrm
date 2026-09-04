'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, PlugZap } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface EmailHealth {
  configured: boolean;
  reachable: boolean;
  version?: string;
  error?: string;
}

/**
 * Gate for every Email page.
 *
 * The email engine is a separate service, so "not set up" and "set up
 * but down" are genuinely different states with different fixes, and
 * an operator needs to be told which one they're in rather than
 * getting a generic failure.
 */
export function ListmonkGate({
  children,
}: {
  children: (health: EmailHealth) => React.ReactNode;
}) {
  const t = useTranslations('Email.status');
  const [health, setHealth] = useState<EmailHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/email/health')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setHealth(d);
      })
      .catch(() => {
        if (!cancelled)
          setHealth({ configured: true, reachable: false, error: 'network' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!health) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!health.configured) {
    return (
      <div className="border-border bg-card flex flex-col items-center justify-center rounded-xl border p-10 text-center">
        <PlugZap className="text-muted-foreground mb-3 h-10 w-10" />
        <p className="text-foreground text-sm font-medium">
          {t('notConfiguredTitle')}
        </p>
        <p className="text-muted-foreground mt-1 max-w-md text-xs">
          {t('notConfiguredBody')}
        </p>
        <code className="border-border bg-muted text-muted-foreground mt-4 rounded-md border px-3 py-2 text-left text-[11px] leading-relaxed">
          LISTMONK_URL=http://listmonk:9000
          <br />
          LISTMONK_API_USER=wacrm_api
          <br />
          LISTMONK_API_TOKEN=…
        </code>
      </div>
    );
  }

  if (!health.reachable) {
    return (
      <div className="border-border bg-card flex flex-col items-center justify-center rounded-xl border p-10 text-center">
        <AlertTriangle className="mb-3 h-10 w-10 text-amber-400" />
        <p className="text-foreground text-sm font-medium">
          {t('unreachableTitle')}
        </p>
        <p className="text-muted-foreground mt-1 max-w-md text-xs">
          {health.error ?? t('unreachableBody')}
        </p>
      </div>
    );
  }

  return <>{children(health)}</>;
}
