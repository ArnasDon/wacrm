'use client';

// ============================================================
// DataSourcesSettings — AI Agents → Setup → Data sources
//
// Google Sheets / remote CSV / uploaded CSV sources the AI agent can
// draw on, independently of the Budun ERP Catalog integration (see
// catalog-integrations-settings.tsx). Each source picks its own
// `usage`: knowledge-only content still lands in the existing
// Knowledge Base retrieval path; catalog/both additionally populates
// the structured product table the search_catalog/get_product/
// get_availability/get_product_media tools query.
//
// Rendered from src/components/settings/ai-config.tsx (AI Agents →
// Setup), not from the generic Settings rail — every source the agent
// itself consults belongs there (AI_Catalog_Fix_Kit FASE 3).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Database, Eye, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
import { DestructiveConfirmDialog } from '@/components/ui/destructive-confirm-dialog';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { SettingsPanelHead } from './settings-panel-head';
import { DataSourcePreviewDialog } from './data-source-preview-dialog';

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

function fmtDate(iso: string | null, never: string): string {
  if (!iso) return never;
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function DataSourcesSettings() {
  const t = useTranslations('Settings.dataSources');
  const { defaultCurrency } = useAuth();
  const [sources, setSources] = useState<DataSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRefreshInputRef = useRef<HTMLInputElement | null>(null);
  const [refreshTargetId, setRefreshTargetId] = useState<string | null>(null);
  const [previewSourceId, setPreviewSourceId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DataSourceRow | null>(null);

  const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
    google_sheets: t('sourceTypeGoogleSheets'),
    remote_csv: t('sourceTypeRemoteCsv'),
    uploaded_csv: t('sourceTypeUploadedCsv'),
  };
  const USAGE_LABEL: Record<Usage, string> = {
    knowledge: t('usageKnowledge'),
    catalog: t('usageCatalog'),
    both: t('usageBoth'),
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/data-sources', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('loadFailed'));
        return;
      }
      setSources(data.data_sources ?? []);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // The actual delete, run only from DestructiveConfirmDialog's confirm
  // button below — never directly from the row's trash icon. Throws on
  // failure so the dialog stays open and shows the error instead of
  // silently pretending the source was removed.
  async function performDelete(source: DataSourceRow) {
    setBusyId(source.id);
    try {
      let res: Response;
      try {
        res = await fetch(`/api/ai/data-sources/${source.id}`, { method: 'DELETE' });
      } catch {
        throw new Error(t('networkError'));
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('deleteFailed'));
      toast.success(t('deleteSuccess'));
      setSources((prev) => prev.filter((s) => s.id !== source.id));
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
        toast.error(data.error || t('refreshFailed'));
        return;
      }
      toast.success(t('refreshSuccess', { rows: data.data_source?.row_count ?? 0 }));
      // Non-fatal: the sync above already succeeded. Just lets the user
      // know a previously-selected column vanished upstream (point 17)
      // — their selection itself is untouched, so it reactivates on its
      // own if the column comes back in a later sync.
      const dropped: string[] = data.dropped_columns ?? [];
      if (dropped.length > 0) {
        toast.warning(t('columnsNoLongerExist', { columns: dropped.join(', ') }));
      }
      await load();
    } catch {
      toast.error(t('networkError'));
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
        toast.error(data.error || t('updateFailed'));
        return;
      }
      await load();
    } catch {
      toast.error(t('networkError'));
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
        toast.error(data.error || t('updateFailed'));
        return;
      }
      await load();
    } catch {
      toast.error(t('networkError'));
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
              {t('addDataSource')}
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
            <p className="text-muted-foreground mt-2 text-sm">{t('noDataSources')}</p>
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
                      {s.status === 'active' ? t('statusActive') : s.status === 'error' ? t('statusError') : t('statusDisabled')}
                    </Badge>
                    {s.is_primary && (
                      <Badge className="border-primary/40 bg-primary/10 text-primary text-[10px]">{t('primaryBadge')}</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t('priorityInfo', {
                      priority: s.priority,
                      rows: s.row_count ?? 0,
                      date: fmtDate(s.last_synced_at, t('never')),
                    })}
                    {s.fallback_policy !== 'fallback_on_not_found' ? ` · ${s.fallback_policy}` : ''}
                  </p>
                  {s.last_error && <p className="text-xs text-red-400">{s.last_error}</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {/* Read-only, so it's available to any viewer — not
                        wrapped in the admin-only RequireRole block below.
                        See data-source-preview-dialog.tsx. */}
                    <Button variant="outline" size="sm" onClick={() => setPreviewSourceId(s.id)}>
                      <Eye className="size-3.5" />
                      {t('viewData')}
                    </Button>
                  </div>
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
                        {t('refresh')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === s.id}
                        onClick={() => handleTogglePrimary(s)}
                      >
                        {s.is_primary ? t('unsetPrimary') : t('setPrimary')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === s.id}
                        onClick={() => handleToggleStatus(s)}
                      >
                        {s.status === 'disabled' ? t('enable') : t('disable')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === s.id}
                        onClick={() => setDeleteTarget(s)}
                        className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                      >
                        <Trash2 className="size-3.5" />
                        {t('delete')}
                      </Button>
                    </div>
                  </RequireRole>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <CreateDataSourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={load}
        defaultCurrency={defaultCurrency}
        usageLabel={USAGE_LABEL}
      />

      <DataSourcePreviewDialog sourceId={previewSourceId} onOpenChange={(open) => { if (!open) setPreviewSourceId(null); }} />

      <DestructiveConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => { if (!next) setDeleteTarget(null); }}
        title={t('deleteConfirmTitle')}
        description={t('deleteConfirmDescription', { name: deleteTarget?.display_name ?? '' })}
        cancelLabel={t('deleteConfirmCancel')}
        confirmLabel={t('deleteConfirmButton')}
        errorFallback={t('deleteFailed')}
        onConfirm={async () => {
          if (deleteTarget) await performDelete(deleteTarget);
        }}
      />
    </section>
  );
}

interface ColumnDetection {
  /** Every real header found in the file/sheet — always complete. */
  columns: string[];
  /** First few rows, keyed by raw header name. */
  sample: Record<string, string>[];
}

function CreateDataSourceDialog({
  open,
  onOpenChange,
  onCreated,
  defaultCurrency,
  usageLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  defaultCurrency: string;
  usageLabel: Record<Usage, string>;
}) {
  const t = useTranslations('Settings.dataSources');
  const [step, setStep] = useState<'details' | 'columns'>('details');
  const [sourceType, setSourceType] = useState<SourceType>('google_sheets');
  const [displayName, setDisplayName] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [usage, setUsage] = useState<Usage>('knowledge');
  const [fallbackPolicy, setFallbackPolicy] = useState<FallbackPolicy>('fallback_on_not_found');
  const [isPrimary, setIsPrimary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [currency, setCurrency] = useState(defaultCurrency || 'USD');

  // Step 2 state — populated by handleDetectColumns, driven entirely
  // by what was ACTUALLY found in the file/sheet (no fixed schema —
  // see the module doc in data-source-preview-dialog.tsx for why).
  const [detection, setDetection] = useState<ColumnDetection | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());

  // Re-seed the currency once the account's real default arrives (it's
  // not known on first render) — without this every source silently
  // defaults to the hook's placeholder value instead of the account's
  // actual configured currency.
  useEffect(() => {
    if (defaultCurrency) setCurrency(defaultCurrency);
  }, [defaultCurrency]);

  function reset() {
    setStep('details');
    setSourceType('google_sheets');
    setDisplayName('');
    setUrl('');
    setFile(null);
    setUsage('knowledge');
    setFallbackPolicy('fallback_on_not_found');
    setIsPrimary(false);
    setSubmitting(false);
    setDetecting(false);
    setDetection(null);
    setSelectedColumns(new Set());
    setCurrency(defaultCurrency || 'USD');
  }

  // Reuses the SAME preview endpoint the legacy inventory uploader
  // already used (/api/ai/knowledge/inventory/preview) — it parses
  // without persisting anything, returning every real header it
  // found. No second detection implementation.
  async function handleDetectColumns() {
    if (!displayName.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    if (sourceType !== 'uploaded_csv' && !url.trim()) {
      toast.error(t('urlRequired'));
      return;
    }
    if (sourceType === 'uploaded_csv' && !file) {
      toast.error(t('chooseFile'));
      return;
    }
    setDetecting(true);
    try {
      let res: Response;
      if (sourceType === 'uploaded_csv' && file) {
        const fd = new FormData();
        fd.set('file', file);
        res = await fetch('/api/ai/knowledge/inventory/preview', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/ai/knowledge/inventory/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('detectColumnsFailed'));
        return;
      }
      const columns: string[] = data.metadata?.columns ?? [];
      const sample: Record<string, string>[] = data.preview?.sample ?? [];
      if (columns.length === 0) {
        toast.error(t('detectColumnsFailed'));
        return;
      }
      setDetection({ columns, sample });
      setSelectedColumns(new Set(columns)); // every real column pre-checked, matching the legacy uploader's default
      setStep('columns');
    } catch {
      toast.error(t('networkError'));
    } finally {
      setDetecting(false);
    }
  }

  function toggleColumn(col: string) {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  }

  async function handleCreate() {
    if (selectedColumns.size === 0) {
      toast.error(t('selectAtLeastOneColumn'));
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
      fd.set('currency', currency.trim() || defaultCurrency || 'USD');
      // Always sent, explicitly, once the user has been through the
      // detection/selection step — even when every column stayed
      // checked. `selected_columns` must never persist as null for a
      // source created through this wizard; null is reserved for
      // sources that predate the column-selection feature entirely
      // (final-audit finding: this used to only send the field when
      // something was EXCLUDED, so the default "leave everything
      // checked" path — the common case — silently saved null instead
      // of the explicit list the user had just configured).
      fd.set('selected_columns', JSON.stringify(Array.from(selectedColumns)));
      if (sourceType === 'uploaded_csv' && file) fd.set('file', file);
      else fd.set('url', url.trim());

      const res = await fetch('/api/ai/data-sources', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('createFailed'));
        return;
      }
      toast.success(t('createSuccess', { rows: data.data_source?.row_count ?? 0 }));
      reset();
      onOpenChange(false);
      onCreated();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  const previewColumns = detection ? detection.columns.filter((c) => selectedColumns.has(c)) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="border-border bg-popover flex max-h-[85vh] w-[min(1100px,calc(100vw-2rem))] max-w-none flex-col sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {step === 'details' ? t('createTitle') : t('detectColumnsTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {step === 'details' ? t('createDesc') : t('detectColumnsDesc')}
          </DialogDescription>
        </DialogHeader>

        {step === 'details' && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t('sourceLabel')}</Label>
                <Select value={sourceType} onValueChange={(v) => setSourceType(v as SourceType)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="google_sheets">{t('sourceGoogleSheetsOption')}</SelectItem>
                    <SelectItem value="remote_csv">{t('sourceRemoteCsvOption')}</SelectItem>
                    <SelectItem value="uploaded_csv">{t('sourceUploadOption')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t('nameLabel')}</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                />
              </div>
            </div>

            {sourceType === 'uploaded_csv' ? (
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t('fileLabel')}</Label>
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t('urlLabel')}</Label>
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t('useForLabel')}</Label>
                <Select value={usage} onValueChange={(v) => setUsage(v as Usage)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="knowledge">{usageLabel.knowledge}</SelectItem>
                    <SelectItem value="catalog">{usageLabel.catalog}</SelectItem>
                    <SelectItem value="both">{usageLabel.both}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">{t('usageHint')}</p>
              </div>

              {(usage === 'catalog' || usage === 'both') && (
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t('currencyLabel')}</Label>
                  <Input
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                    placeholder="USD"
                    maxLength={3}
                    className="w-24 uppercase"
                  />
                  <p className="text-muted-foreground text-xs">
                    {t('currencyHint', { currency: defaultCurrency || 'USD' })}
                  </p>
                </div>
              )}

              {(usage === 'catalog' || usage === 'both') && (
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t('fallbackLabel')}</Label>
                  <Select value={fallbackPolicy} onValueChange={(v) => setFallbackPolicy(v as FallbackPolicy)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fallback_on_not_found">{t('fallbackOnNotFound')}</SelectItem>
                      <SelectItem value="primary_only">{t('fallbackPrimaryOnly')}</SelectItem>
                      <SelectItem value="search_all_active">{t('fallbackSearchAll')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2.5">
              <Checkbox checked={isPrimary} onCheckedChange={(c) => setIsPrimary(c === true)} />
              <span className="text-foreground text-sm">{t('setPrimaryCheckbox')}</span>
            </label>
          </div>
        )}

        {step === 'columns' && detection && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">{t('detectedColumnsHeading')}</p>
              <p className="mb-2 text-xs text-muted-foreground">{t('detectedColumnsHint')}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border p-3 sm:grid-cols-3 md:grid-cols-4">
                {detection.columns.map((col) => (
                  <label key={col} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={selectedColumns.has(col)} onCheckedChange={() => toggleColumn(col)} />
                    <span className="truncate text-foreground" title={col}>{col}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-foreground">{t('previewSampleTitle')}</p>
              {previewColumns.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  {t('selectAtLeastOneColumn')}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50">
                        {previewColumns.map((col) => (
                          <th key={col} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-muted-foreground">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detection.sample.map((row, ri) => (
                        <tr key={ri} className="border-t border-border">
                          {previewColumns.map((col) => (
                            <td key={col} className="max-w-60 truncate px-2 py-1.5 text-foreground">
                              {row[col] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'details' ? (
            <>
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
              <Button onClick={handleDetectColumns} disabled={detecting}>
                {detecting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('detectingColumns')}
                  </>
                ) : (
                  t('detectColumnsButton')
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep('details')}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {t('back')}
              </Button>
              <Button onClick={handleCreate} disabled={submitting || selectedColumns.size === 0}>
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('adding')}
                  </>
                ) : (
                  t('addDataSource')
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
