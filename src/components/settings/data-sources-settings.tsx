'use client';

// ============================================================
// DataSourcesSettings — Settings → Data Sources
//
// Google Sheets / remote CSV / uploaded CSV sources the AI agent can
// draw on, independently of the Budun ERP Catalog integration (see
// catalog-integrations-settings.tsx). Each source picks its own
// `usage`: knowledge-only content still lands in the existing
// Knowledge Base retrieval path; catalog/both additionally populates
// the structured product table the search_catalog/get_product/
// get_availability/get_product_media tools query.
//
// Kept intentionally plain (no next-intl wiring) — this is a large new
// settings surface layered on top of an already sizeable feature; see
// the implementation report for the i18n follow-up note.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Database, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { RequireRole } from '@/components/auth/require-role';
import { SettingsPanelHead } from './settings-panel-head';

type SourceType = 'google_sheets' | 'remote_csv' | 'uploaded_csv';
type Usage = 'knowledge' | 'catalog' | 'both';
type FallbackPolicy = 'primary_only' | 'fallback_on_not_found' | 'search_all_active';

interface DataSourceRow {
  id: string;
  source_type: SourceType;
  display_name: string;
  source_url: string | null;
  source_filename: string | null;
  usage: Usage;
  status: 'active' | 'disabled' | 'error';
  priority: number;
  is_primary: boolean;
  fallback_policy: FallbackPolicy;
  currency: string;
  row_count: number | null;
  last_synced_at: string | null;
  last_error: string | null;
}

const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  google_sheets: 'Google Sheets',
  remote_csv: 'Remote CSV',
  uploaded_csv: 'Uploaded CSV',
};

const USAGE_LABEL: Record<Usage, string> = {
  knowledge: 'Knowledge base only',
  catalog: 'Catalog only (search_catalog / get_product / …)',
  both: 'Both — knowledge base + catalog',
};

function fmtDate(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function DataSourcesSettings() {
  const [sources, setSources] = useState<DataSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRefreshInputRef = useRef<HTMLInputElement | null>(null);
  const [refreshTargetId, setRefreshTargetId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/data-sources', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to load data sources.');
        return;
      }
      setSources(data.data_sources ?? []);
    } catch {
      toast.error('Network error while loading data sources.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(source: DataSourceRow) {
    if (!confirm(`Delete "${source.display_name}"? This removes its knowledge/catalog content.`)) return;
    setBusyId(source.id);
    try {
      const res = await fetch(`/api/ai/data-sources/${source.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Delete failed.');
        return;
      }
      toast.success('Data source deleted.');
      setSources((prev) => prev.filter((s) => s.id !== source.id));
    } catch {
      toast.error('Network error.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRefresh(source: DataSourceRow, file?: File) {
    if (source.source_type === 'uploaded_csv' && !file) {
      setRefreshTargetId(source.id);
      fileRefreshInputRef.current?.click();
      return;
    }
    setBusyId(source.id);
    try {
      let res: Response;
      if (file) {
        const fd = new FormData();
        fd.set('file', file);
        res = await fetch(`/api/ai/data-sources/${source.id}/refresh`, { method: 'POST', body: fd });
      } else {
        res = await fetch(`/api/ai/data-sources/${source.id}/refresh`, { method: 'POST' });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Refresh failed.');
        return;
      }
      toast.success(`Refreshed — ${data.data_source?.row_count ?? 0} rows.`);
      await load();
    } catch {
      toast.error('Network error.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTogglePrimary(source: DataSourceRow) {
    setBusyId(source.id);
    try {
      const res = await fetch(`/api/ai/data-sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_primary: !source.is_primary }),
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

  async function handleToggleStatus(source: DataSourceRow) {
    const nextStatus = source.status === 'disabled' ? 'active' : 'disabled';
    setBusyId(source.id);
    try {
      const res = await fetch(`/api/ai/data-sources/${source.id}`, {
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
        title="Data Sources"
        description="Google Sheets, remote CSV and uploaded CSV files the AI agent can use for its knowledge base and/or product catalog. The Knowledge Base itself (policies, hours, FAQ) keeps working independently — see the Knowledge Base tab under AI Agents."
        action={
          <RequireRole min="admin">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Add data source
            </Button>
          </RequireRole>
        }
      />

      <input
        ref={fileRefreshInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const source = sources.find((s) => s.id === refreshTargetId);
          e.target.value = '';
          if (file && source) void handleRefresh(source, file);
        }}
      />

      {sources.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Database className="text-muted-foreground size-6" />
            <p className="text-muted-foreground mt-2 text-sm">No data sources configured yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {sources.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground text-sm font-medium">{s.display_name}</span>
                    <Badge className="border-border bg-muted text-muted-foreground text-[10px]">
                      {SOURCE_TYPE_LABEL[s.source_type]}
                    </Badge>
                    <Badge className="border-border bg-muted text-muted-foreground text-[10px]">
                      {USAGE_LABEL[s.usage]}
                    </Badge>
                    <Badge
                      className={`text-[10px] ${
                        s.status === 'active'
                          ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300'
                          : s.status === 'error'
                            ? 'border-red-700/50 bg-red-950/30 text-red-300'
                            : 'border-border bg-muted text-muted-foreground'
                      }`}
                    >
                      {s.status}
                    </Badge>
                    {s.is_primary && (
                      <Badge className="border-primary/40 bg-primary/10 text-primary text-[10px]">primary</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Priority {s.priority} · {s.row_count ?? 0} rows · last synced {fmtDate(s.last_synced_at)}
                    {s.fallback_policy !== 'fallback_on_not_found' ? ` · ${s.fallback_policy}` : ''}
                  </p>
                  {s.last_error && <p className="text-xs text-red-400">{s.last_error}</p>}
                  <RequireRole min="admin">
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === s.id}
                        onClick={() => handleRefresh(s)}
                      >
                        {busyId === s.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3.5" />
                        )}
                        Refresh
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === s.id}
                        onClick={() => handleTogglePrimary(s)}
                      >
                        {s.is_primary ? 'Unset primary' : 'Set primary'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === s.id}
                        onClick={() => handleToggleStatus(s)}
                      >
                        {s.status === 'disabled' ? 'Enable' : 'Disable'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === s.id}
                        onClick={() => handleDelete(s)}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    </div>
                  </RequireRole>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <CreateDataSourceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
    </section>
  );
}

function CreateDataSourceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [sourceType, setSourceType] = useState<SourceType>('google_sheets');
  const [displayName, setDisplayName] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [usage, setUsage] = useState<Usage>('knowledge');
  const [fallbackPolicy, setFallbackPolicy] = useState<FallbackPolicy>('fallback_on_not_found');
  const [isPrimary, setIsPrimary] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setSourceType('google_sheets');
    setDisplayName('');
    setUrl('');
    setFile(null);
    setUsage('knowledge');
    setFallbackPolicy('fallback_on_not_found');
    setIsPrimary(false);
    setSubmitting(false);
  }

  async function handleCreate() {
    if (!displayName.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (sourceType !== 'uploaded_csv' && !url.trim()) {
      toast.error('URL is required.');
      return;
    }
    if (sourceType === 'uploaded_csv' && !file) {
      toast.error('Choose a file to upload.');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.set('source_type', sourceType);
      fd.set('display_name', displayName.trim());
      fd.set('usage', usage);
      fd.set('fallback_policy', fallbackPolicy);
      fd.set('is_primary', String(isPrimary));
      if (sourceType === 'uploaded_csv' && file) fd.set('file', file);
      else fd.set('url', url.trim());

      const res = await fetch('/api/ai/data-sources', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to create data source.');
        return;
      }
      toast.success(`Added — ${data.data_source?.row_count ?? 0} rows detected.`);
      reset();
      onOpenChange(false);
      onCreated();
    } catch {
      toast.error('Network error.');
    } finally {
      setSubmitting(false);
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
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Add data source</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Connect a Google Sheet, a remote CSV URL, or upload a CSV/Excel file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Source</Label>
            <Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="google_sheets">Google Sheets (public CSV link)</SelectItem>
                <SelectItem value="remote_csv">Remote CSV URL</SelectItem>
                <SelectItem value="uploaded_csv">Upload CSV / Excel</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Product catalog, Store hours"
            />
          </div>

          {sourceType === 'uploaded_csv' ? (
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">File</Label>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">URL</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  sourceType === 'google_sheets'
                    ? 'https://docs.google.com/spreadsheets/d/.../export?format=csv'
                    : 'https://example.com/products.csv'
                }
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-muted-foreground">Use for</Label>
            <Select value={usage} onValueChange={(v) => setUsage(v as Usage)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="knowledge">{USAGE_LABEL.knowledge}</SelectItem>
                <SelectItem value="catalog">{USAGE_LABEL.catalog}</SelectItem>
                <SelectItem value="both">{USAGE_LABEL.both}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              &quot;Catalog&quot; rows are only ever returned through the agent&apos;s search_catalog/get_product
              tools — never pasted into the prompt — so price/stock can&apos;t be guessed from memory.
            </p>
          </div>

          {(usage === 'catalog' || usage === 'both') && (
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">If another catalog source already has a match</Label>
              <Select value={fallbackPolicy} onValueChange={(v) => setFallbackPolicy(v as FallbackPolicy)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fallback_on_not_found">Use this source only if others found nothing</SelectItem>
                  <SelectItem value="primary_only">Never fall back to other sources</SelectItem>
                  <SelectItem value="search_all_active">Always search alongside other active sources</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2.5">
            <Checkbox checked={isPrimary} onCheckedChange={(c) => setIsPrimary(c === true)} />
            <span className="text-foreground text-sm">Set as primary source</span>
          </label>
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
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Adding…
              </>
            ) : (
              'Add data source'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
