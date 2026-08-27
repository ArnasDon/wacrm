'use client';

// ============================================================
// DataSourcePreviewDialog — "Ver datos" for one AI Data Source.
//
// Reads GET /api/ai/data-sources/[id]/preview (src/lib/ai/data-
// sources/service.ts::getDataSourcePreview), which itself reads back
// whatever the last create/refresh actually persisted — never
// re-fetches or re-parses the source. For usage catalog/both this is
// a live sample straight from ai_catalog_products (the same table
// search_catalog/get_product query), so what's shown here can never
// disagree with what the agent can say. For usage knowledge (no
// structured rows exist) it falls back to the parse-time snapshot
// captured in ai_data_sources.preview_sample (migration 046).
//
// This replaces, for the new Data Sources system, the preview table
// AiKnowledgeCard's legacy InventoryUploader only ever showed BEFORE
// saving (see ai-knowledge.tsx) — the gap the unification pass was
// asked to close: a saved source had no way to look at its own data
// again.
// ============================================================

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type PreviewKind = 'catalog' | 'knowledge' | 'empty';

interface PreviewSource {
  id: string;
  display_name: string;
  source_type: 'google_sheets' | 'remote_csv' | 'uploaded_csv';
  status: 'active' | 'disabled' | 'error';
  usage: 'knowledge' | 'catalog' | 'both';
  currency: string;
  priority: number;
  row_count: number | null;
  last_synced_at: string | null;
  last_error: string | null;
  column_mapping: Record<string, string | null> | null;
}

interface PreviewResponse {
  data_source: PreviewSource;
  preview: { kind: PreviewKind; columns: string[]; rows: Record<string, unknown>[] };
}

const DETECTED_ROLES = [
  'sku', 'name', 'price', 'stock', 'category',
  'brand', 'model', 'description', 'color', 'capacity', 'size', 'image',
] as const;

const COLUMN_LABEL_KEY: Record<string, string> = {
  sku: 'colSku', name: 'colName', price: 'colPrice', stock: 'colStock', category: 'colCategory',
  brand: 'colBrand', model: 'colModel', description: 'colDescription', color: 'colColor',
  capacity: 'colCapacity', size: 'colSize', image: 'colImage',
  currency: 'colCurrency', available_quantity: 'colStock',
};

function fmtDate(iso: string | null, never: string): string {
  if (!iso) return never;
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function DataSourcePreviewDialog({
  sourceId,
  onOpenChange,
}: {
  /** null closes the dialog. */
  sourceId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('Settings.dataSources');
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const res = await fetch(`/api/ai/data-sources/${sourceId}/preview`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || t('previewLoadFailed'));
          return;
        }
        setData(json);
      } catch {
        if (!cancelled) setError(t('previewLoadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [sourceId, t]);

  const open = sourceId !== null;
  const source = data?.data_source;
  const preview = data?.preview;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
      <DialogContent className="border-border bg-popover flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {source ? t('previewTitle', { name: source.display_name }) : t('viewData')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">{t('previewDesc')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {loading && (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> {t('previewLoading')}
            </div>
          )}

          {!loading && error && <p className="py-6 text-center text-sm text-red-400">{error}</p>}

          {!loading && !error && source && preview && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-border bg-muted text-muted-foreground text-[10px]">
                  {source.source_type}
                </Badge>
                <Badge
                  className={`text-[10px] ${
                    source.status === 'active'
                      ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300'
                      : source.status === 'error'
                        ? 'border-red-700/50 bg-red-950/30 text-red-300'
                        : 'border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {source.status === 'active' ? t('statusActive') : source.status === 'error' ? t('statusError') : t('statusDisabled')}
                </Badge>
                <Badge className="border-border bg-muted text-muted-foreground text-[10px]">
                  {source.usage === 'knowledge' ? t('usageKnowledge') : source.usage === 'catalog' ? t('usageCatalog') : t('usageBoth')}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border p-3 text-xs sm:grid-cols-4">
                <div><span className="text-muted-foreground">{t('previewMetaCurrency')}: </span><span className="font-medium text-foreground">{source.currency}</span></div>
                <div><span className="text-muted-foreground">{t('previewMetaPriority')}: </span><span className="font-medium text-foreground">{source.priority}</span></div>
                <div><span className="text-muted-foreground">{t('previewMetaRows')}: </span><span className="font-medium text-foreground">{source.row_count ?? 0}</span></div>
                <div><span className="text-muted-foreground">{t('previewMetaLastSync')}: </span><span className="font-medium text-foreground">{fmtDate(source.last_synced_at, t('never'))}</span></div>
              </div>

              {source.last_error && (
                <div className="rounded-md border border-red-700/40 bg-red-950/20 p-3 text-xs text-red-300">
                  <p className="mb-1 font-medium">{t('previewErrorsTitle')}</p>
                  <p>{source.last_error}</p>
                </div>
              )}

              {source.column_mapping && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-foreground">{t('previewColumnsTitle')}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border p-3 text-xs sm:grid-cols-3">
                    {DETECTED_ROLES.map((role) => {
                      const value = source.column_mapping?.[role] ?? null;
                      return (
                        <div key={role} className="flex items-center gap-1">
                          <span className="shrink-0 text-muted-foreground">{t(COLUMN_LABEL_KEY[role])}: </span>
                          <span className={value ? 'truncate font-medium text-foreground' : 'shrink-0 text-muted-foreground/70'}>
                            {value ?? t('notDetected')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-xs font-medium text-foreground">{t('previewSampleTitle')}</p>
                {preview.kind === 'empty' ? (
                  <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    {t('previewEmpty')}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          {preview.columns.map((col) => (
                            <TableHead key={col} className="text-[11px]">
                              {preview.kind === 'catalog' ? t(COLUMN_LABEL_KEY[col] ?? col) : col}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.rows.map((row, ri) => (
                          <TableRow key={ri}>
                            {preview.columns.map((col) => (
                              <TableCell key={col} className="max-w-48 truncate text-xs">
                                {String(row[col] ?? '')}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border text-muted-foreground hover:bg-muted">
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
