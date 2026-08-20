'use client';

import { readResponseJson } from '@/lib/http/response-json';

// ============================================================
// WebhooksSettings — Settings → Webhooks
//
// Manage outbound event webhooks (src/lib/webhooks/*) — the same
// signed-delivery system n8n (or any HTTP endpoint) subscribes to.
// Structure mirrors api-keys-settings.tsx: any member sees the
// roster (read-only), admin+ can create/edit/delete (gated by
// <RequireRole min="admin"> here and the admin-only API routes + RLS
// on the server). The signing secret is a one-time reveal, same
// contract as an API key's plaintext.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Webhook as WebhookIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_DESCRIPTIONS,
  type WebhookEvent,
} from '@/lib/webhooks/events';
import { useTranslations } from 'next-intl';
import { SettingsPanelHead } from './settings-panel-head';

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  last_delivery_at: string | null;
  failure_count: number;
  created_at: string;
}

interface Delivery {
  id: string;
  event: string;
  status: 'pending' | 'processing' | 'delivered' | 'failed';
  attempt_count: number;
  next_retry_at: string | null;
  last_attempt_at: string | null;
  response_status: number | null;
  response_snippet: string | null;
  created_at: string;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WebhooksSettings() {
  const { canEditSettings } = useAuth();
  const t = useTranslations('Settings.webhooksTab');

  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/webhooks', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await readResponseJson(res).catch(() => ({}));
        toast.error(payload.error || t('loadFailed'));
        return;
      }
      const data = await readResponseJson<{ webhooks: WebhookEndpoint[] }>(res);
      setEndpoints(data.webhooks);
    } catch (err) {
      console.error('[WebhooksSettings] load error:', err);
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggleActive(endpoint: WebhookEndpoint) {
    setBusyId(endpoint.id);
    try {
      const res = await fetch(`/api/account/webhooks/${endpoint.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !endpoint.is_active }),
      });
      if (!res.ok) {
        const payload = await readResponseJson(res).catch(() => ({}));
        toast.error(payload.error || t('updateFailed'));
        return;
      }
      toast.success(
        endpoint.is_active ? t('disabledSuccess') : t('enabledSuccess')
      );
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(endpoint: WebhookEndpoint) {
    setBusyId(endpoint.id);
    try {
      const res = await fetch(`/api/account/webhooks/${endpoint.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = await readResponseJson(res).catch(() => ({}));
        toast.error(payload.error || t('deleteFailed'));
        return;
      }
      toast.success(t('deleteSuccess'));
      setEndpoints((prev) => prev.filter((e) => e.id !== endpoint.id));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          <RequireRole min="admin">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t('newWebhook')}
            </Button>
          </RequireRole>
        }
      />

      {endpoints.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <WebhookIcon className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">
              {t('noWebhooks')}
            </p>
            {!canEditSettings && (
              <p className="text-muted-foreground mt-1 text-xs">
                {t('askAdminHint')}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {endpoints.map((e) => (
                <li key={e.id} className="flex flex-col gap-3 px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`truncate text-sm font-medium ${
                            e.is_active
                              ? 'text-foreground'
                              : 'text-muted-foreground line-through'
                          }`}
                        >
                          {e.url}
                        </span>
                        {!e.is_active && (
                          <Badge className="border-border bg-muted text-muted-foreground text-[10px] tracking-wide uppercase">
                            {t('disabled')}
                          </Badge>
                        )}
                        {e.is_active && e.failure_count > 0 && (
                          <Badge className="border-amber-600/40 bg-amber-950/40 text-[10px] tracking-wide text-amber-300 uppercase">
                            {t('failuresBadge', { count: e.failure_count })}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {e.events.map((ev) => (
                          <Badge
                            key={ev}
                            className="border-border bg-muted text-muted-foreground text-[10px]"
                          >
                            {ev}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-muted-foreground mt-1.5 text-xs">
                        {t('created', { date: fmtDate(e.created_at) })}
                        {e.last_delivery_at
                          ? ` · ${t('lastDelivery', { date: fmtDate(e.last_delivery_at) })}`
                          : ''}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setExpandedId(expandedId === e.id ? null : e.id)
                        }
                        className="border-border text-muted-foreground hover:bg-muted"
                      >
                        {expandedId === e.id
                          ? t('hideDeliveries')
                          : t('viewDeliveries')}
                      </Button>
                      <RequireRole min="admin">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleActive(e)}
                          disabled={busyId === e.id}
                          className="border-border text-muted-foreground hover:bg-muted"
                        >
                          {busyId === e.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : null}
                          {e.is_active ? t('disable') : t('enable')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(e)}
                          disabled={busyId === e.id}
                          className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                        >
                          <Trash2 className="size-4" />
                          {t('delete')}
                        </Button>
                      </RequireRole>
                    </div>
                  </div>

                  {expandedId === e.id && <DeliveryLog endpointId={e.id} />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <CreateWebhookDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={load}
      />
    </section>
  );
}

// ------------------------------------------------------------
// Delivery log — recent attempts for one endpoint, with "Retry now"
// on anything not yet delivered.
// ------------------------------------------------------------

function DeliveryLog({ endpointId }: { endpointId: string }) {
  const t = useTranslations('Settings.webhooksTab');
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/account/webhooks/${endpointId}/deliveries`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      setDeliveries([]);
      return;
    }
    const data = await readResponseJson<{ deliveries: Delivery[] }>(res);
    setDeliveries(data.deliveries);
  }, [endpointId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRetry(deliveryId: string) {
    setRetryingId(deliveryId);
    try {
      const res = await fetch(
        `/api/account/webhooks/${endpointId}/deliveries/${deliveryId}/retry`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const payload = await readResponseJson(res).catch(() => ({}));
        toast.error(payload.error || t('retryFailed'));
        return;
      }
      toast.success(t('retryScheduled'));
      await load();
    } finally {
      setRetryingId(null);
    }
  }

  if (deliveries === null) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
      </div>
    );
  }

  if (deliveries.length === 0) {
    return (
      <p className="text-muted-foreground py-3 text-xs">{t('noDeliveries')}</p>
    );
  }

  return (
    <div className="border-border bg-card/50 rounded-md border">
      <ul className="divide-border divide-y">
        {deliveries.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
          >
            <div className="min-w-0">
              <span className="text-foreground font-medium">{d.event}</span>
              <span
                className={`ml-2 ${
                  d.status === 'delivered'
                    ? 'text-emerald-400'
                    : d.status === 'failed'
                      ? 'text-red-400'
                      : 'text-amber-400'
                }`}
              >
                {t(`deliveryStatus.${d.status}`)}
              </span>
              <span className="text-muted-foreground ml-2">
                {t('attempt', { count: d.attempt_count })}
                {d.response_status ? ` · HTTP ${d.response_status}` : ''}
                {' · '}
                {fmtDate(d.created_at)}
              </span>
            </div>
            {d.status !== 'delivered' && (
              <RequireRole min="admin">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRetry(d.id)}
                  disabled={retryingId === d.id}
                  className="border-border text-muted-foreground hover:bg-muted h-7 shrink-0"
                >
                  {retryingId === d.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                  {t('retryNow')}
                </Button>
              </RequireRole>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------
// Create dialog — form → one-time secret reveal.
// ------------------------------------------------------------

function CreateWebhookDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations('Settings.webhooksTab');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  function reset() {
    setUrl('');
    setEvents([]);
    setSubmitting(false);
    setCreatedSecret(null);
  }

  function toggleEvent(event: WebhookEvent, checked: boolean) {
    setEvents((prev) =>
      checked ? [...prev, event] : prev.filter((e) => e !== event)
    );
  }

  async function handleCreate() {
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error(t('urlRequired'));
      return;
    }
    if (events.length === 0) {
      toast.error(t('eventsRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/account/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, events }),
      });
      const payload = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('createError'));
        return;
      }
      setCreatedSecret(payload.secret as string);
      onCreated();
    } catch (err) {
      console.error('[CreateWebhookDialog] create error:', err);
      toast.error(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function copySecret() {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      toast.success(t('copySuccess'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="border-border bg-popover sm:max-w-md">
        {createdSecret ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {t('copyTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('copyDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label className="text-muted-foreground">
                {t('secretLabel')}
              </Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={createdSecret}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={copySecret}>
                  <Copy className="size-4" />
                  {t('copy')}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                {t('done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {t('newWebhookTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('newWebhookDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="webhook-url" className="text-muted-foreground">
                  {t('urlLabel')}
                </Label>
                <Input
                  id="webhook-url"
                  value={url}
                  placeholder="https://your-n8n-instance.com/webhook/..."
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  {t('eventsLabel')}
                </Label>
                <div className="border-border max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
                  {WEBHOOK_EVENTS.map((event) => (
                    <label
                      key={event}
                      className="flex cursor-pointer items-start gap-2.5"
                    >
                      <Checkbox
                        checked={events.includes(event)}
                        onCheckedChange={(checked) =>
                          toggleEvent(event, checked === true)
                        }
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="text-foreground block font-mono text-xs">
                          {event}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {WEBHOOK_EVENT_DESCRIPTIONS[event]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {t('cancel')}
              </Button>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('creating')}
                  </>
                ) : (
                  t('createWebhook')
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
