'use client';

// ============================================================
// CatalogIntegrationsSettings — Settings → Integrations → Inventory API
//
// Configures external Catalog API providers the AI agent's
// search_catalog/get_product/get_availability/get_product_media tools
// can query. Budun ERP is the only authorized `provider` value in this
// execution (see migration 044 / src/lib/budun/client.ts) — the section
// is named generically ("Inventory API") per
// docs/integrations/budun-erp/WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md
// so the same screen can host another ERP later without a rename.
//
// The Application Secret / Catalog API credential is never returned by
// the API after save — this form always POSTs/PATCHes it fresh (blank
// = "leave unchanged" on an edit), mirroring whatsapp-config.tsx's
// masked-token contract.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Plug, Plus, Trash2, XCircle, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Checkbox } from '@/components/ui/checkbox';
import { RequireRole } from '@/components/auth/require-role';
import { SettingsPanelHead } from './settings-panel-head';

interface CatalogIntegrationRow {
  id: string;
  provider: 'budun';
  display_name: string;
  base_url: string;
  app_key: string | null;
  scopes: string[];
  status: 'active' | 'disabled' | 'error';
  is_primary: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_error: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function CatalogIntegrationsSettings() {
  const [integrations, setIntegrations] = useState<CatalogIntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogIntegrationRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/catalog', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to load integrations.');
        return;
      }
      setIntegrations(data.integrations ?? []);
    } catch {
      toast.error('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleTest(integration: CatalogIntegrationRow) {
    setTestingId(integration.id);
    try {
      const res = await fetch(`/api/integrations/catalog/${integration.id}/test`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        toast.success(`Connected — ${data.latencyMs}ms.`);
      } else {
        toast.error(data.message || 'Connection failed.');
      }
      await load();
    } catch {
      toast.error('Network error.');
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete(integration: CatalogIntegrationRow) {
    if (!confirm(`Remove "${integration.display_name}"? The agent will stop using it immediately.`)) return;
    setBusyId(integration.id);
    try {
      const res = await fetch(`/api/integrations/catalog/${integration.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Delete failed.');
        return;
      }
      toast.success('Integration removed.');
      setIntegrations((prev) => prev.filter((i) => i.id !== integration.id));
    } catch {
      toast.error('Network error.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleStatus(integration: CatalogIntegrationRow) {
    const nextStatus = integration.status === 'disabled' ? 'active' : 'disabled';
    setBusyId(integration.id);
    try {
      const res = await fetch(`/api/integrations/catalog/${integration.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Update failed.');
        return;
      }
      await load();
    } catch {
      toast.error('Network error.');
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
        title="Integrations — Inventory API"
        description="Connect an external Catalog API (Budun ERP) so the agent can answer with real, live product/price/stock/photo data instead of the static Knowledge Base. Read-only — WACRM never writes to the ERP."
        action={
          <RequireRole min="admin">
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="size-4" />
              Add integration
            </Button>
          </RequireRole>
        }
      />

      {integrations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Plug className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">No Catalog API integration configured yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {integrations.map((i) => (
                <li key={i.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground text-sm font-medium">{i.display_name}</span>
                    <Badge className="border-border bg-muted text-muted-foreground text-[10px] uppercase">
                      {i.provider}
                    </Badge>
                    <Badge
                      className={`text-[10px] ${
                        i.status === 'active'
                          ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300'
                          : i.status === 'error'
                            ? 'border-red-700/50 bg-red-950/30 text-red-300'
                            : 'border-border bg-muted text-muted-foreground'
                      }`}
                    >
                      {i.status}
                    </Badge>
                    {i.is_primary && (
                      <Badge className="border-primary/40 bg-primary/10 text-primary text-[10px]">primary</Badge>
                    )}
                    {i.last_test_ok === true && <CheckCircle2 className="size-3.5 text-emerald-400" />}
                    {i.last_test_ok === false && <XCircle className="size-3.5 text-red-400" />}
                  </div>
                  <p className="text-muted-foreground font-mono text-xs">{i.base_url}</p>
                  <p className="text-muted-foreground text-xs">
                    Scopes: {i.scopes.join(', ')} · last test {fmtDate(i.last_test_at)}
                  </p>
                  {i.last_error && <p className="text-xs text-red-400">{i.last_error}</p>}
                  <RequireRole min="admin">
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={testingId === i.id}
                        onClick={() => handleTest(i)}
                      >
                        {testingId === i.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Zap className="size-3.5" />
                        )}
                        Test connection
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => { setEditing(i); setDialogOpen(true); }}>
                        Edit / rotate secret
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === i.id}
                        onClick={() => handleToggleStatus(i)}
                      >
                        {i.status === 'disabled' ? 'Enable' : 'Disable'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === i.id}
                        onClick={() => handleDelete(i)}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                      >
                        <Trash2 className="size-3.5" />
                        Remove
                      </Button>
                    </div>
                  </RequireRole>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <IntegrationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={load}
      />
    </section>
  );
}

function IntegrationDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CatalogIntegrationRow | null;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(editing?.display_name ?? '');
  const [baseUrl, setBaseUrl] = useState(editing?.base_url ?? '');
  const [appKey, setAppKey] = useState(editing?.app_key ?? '');
  const [secret, setSecret] = useState('');
  const [isPrimary, setIsPrimary] = useState(editing?.is_primary ?? false);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed the form whenever a different row is opened for editing (or
  // the dialog is (re)opened for "create").
  useEffect(() => {
    if (open) {
      setDisplayName(editing?.display_name ?? '');
      setBaseUrl(editing?.base_url ?? '');
      setAppKey(editing?.app_key ?? '');
      setSecret('');
      setIsPrimary(editing?.is_primary ?? false);
    }
  }, [open, editing]);

  async function handleSave() {
    if (!displayName.trim() || !baseUrl.trim()) {
      toast.error('Name and Base URL are required.');
      return;
    }
    if (!editing && !secret.trim()) {
      toast.error('Application Secret is required for a new integration.');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        provider: 'budun',
        display_name: displayName.trim(),
        base_url: baseUrl.trim(),
        app_key: appKey.trim() || null,
        is_primary: isPrimary,
      };
      if (secret.trim()) body.secret = secret.trim();

      const res = await fetch(
        editing ? `/api/integrations/catalog/${editing.id}` : '/api/integrations/catalog',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Save failed.');
        return;
      }
      toast.success(editing ? 'Integration updated.' : 'Integration added.');
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error('Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {editing ? 'Edit integration' : 'Add Inventory API integration'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Budun ERP — Catalog API. Read-only scopes (catalog:read, catalog:availability:read,
            catalog:media:read). The secret is stored encrypted and never shown again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Display name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Budun ERP" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">ERP Inventory API Base URL</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://erp.example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">
              Application ID / App Key <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input value={appKey} onChange={(e) => setAppKey(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Application Secret</Label>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={editing ? 'Leave blank to keep current secret' : ''}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2.5">
            <Checkbox checked={isPrimary} onCheckedChange={(c) => setIsPrimary(c === true)} />
            <span className="text-foreground text-sm">Use as the primary catalog integration</span>
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
