'use client';

// ============================================================
// DataSourcePreviewDialog — "Ver datos" for one AI Data Source.
//
// Reads GET /api/ai/data-sources/[id]/preview (src/lib/ai/data-
// sources/service.ts::getDataSourcePreview), which itself reads back
// whatever the last create/refresh actually persisted (preview_sample
// — migration 046) — never re-fetches or re-parses the source, and
// never a fixed/structured schema. The columns shown are exactly
// `source.selected_columns` (or every detected column, for a source
// that predates the column-selection step) — the SAME raw header
// names the user picked in "Detectar columnas" when creating the
// source. A sheet with no "Talla"/"Color"/"Capacidad" columns simply
// never shows those — there is no fixed list of expected fields here
// (AI Sales Agent audit — column-selection pass, point 9).
//
// This replaces, for the new Data Sources system, the preview table
// the legacy Inventario uploader (AiKnowledgeCard's InventoryUploader,
// removed once Data Sources fully absorbed it) only ever showed BEFORE
// saving — the gap the unification pass was asked to close: a saved
// source had no way to look at its own data again.
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

type PreviewKind = 'sheet' | 'empty';

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
  /** Only the roles the parser actually detected are ever non-null —
   *  rendered below filtered to those, never a fixed 12-field grid. */
  column_mapping: Record<string, string | null> | null;
  /** null = no explicit selection was ever made (every column is in
   *  use) — falls back to preview.columns in that case. */
  selected_columns: string[] | null;
}

interface PreviewResponse {
  data_source: PreviewSource;
  preview: { kind: PreviewKind; columns: string[]; rows: Record<string, string>[] };
}

/** column_mapping's role keys → their display label. Only rendered for
 *  roles that actually resolved to a real column — see the render
 *  below (`.filter(([, col]) => col !== null)`), never "No detectada"
 *  spam for a field the source doesn't have. */
const ROLE_LABEL_KEY: Record<string, string> = {
  sku: 'colSku', name: 'colName', price: 'colPrice', stock: 'colStock', category: 'colCategory',
  brand: 'colBrand', model: 'colModel', description: 'colDescription', color: 'colColor',
  capacity: 'colCapacity', size: 'colSize', image: 'colImage',
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
  // Falls back to every previewed column when the source predates the
  // selection step (selected_columns is null) — "todas" in that case,
  // matching what the source has always actually used.
  const keptColumns = source?.selected_columns ?? preview?.columns ?? [];
  const keptColumnsLower = new Set(keptColumns.map((c) => c.toLowerCase()));
  // Only a role whose detected column is actually KEPT — a role
  // mapped to a column the user excluded isn't "in use" for anything
  // (buildProductRows nulls it out too), so showing it here would
  // contradict "solo columnas seleccionadas".
  const detectedRoles = source?.column_mapping
    ? Object.entries(source.column_mapping).filter(
        (entry): entry is [string, string] => entry[1] !== null && keptColumnsLower.has(entry[1].toLowerCase()),
      )
    : [];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
      <DialogContent className="border-border bg-popover flex max-h-[85vh] w-[min(1100px,calc(100vw-2rem))] max-w-none flex-col sm:max-w-none">
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

              <div>
                <p className="mb-1.5 text-xs font-medium text-foreground">{t('selectedColumnsTitle')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {keptColumns.map((col) => (
                    <Badge key={col} className="border-primary/30 bg-primary/10 text-primary text-[10px]">
                      {col}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Optional bonus, only for roles that were actually
                  detected among the KEPT columns — never a fixed
                  12-field grid with "No detectada" filler. */}
              {detectedRoles.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-foreground">{t('autoMappingTitle')}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border p-3 text-xs sm:grid-cols-3">
                    {detectedRoles.map(([role, col]) => (
                      <div key={role} className="flex items-center gap-1">
                        <span className="shrink-0 text-muted-foreground">{t(ROLE_LABEL_KEY[role] ?? role)}: </span>
                        <span className="truncate font-medium text-foreground">{col}</span>
                      </div>
                    ))}
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
                            <TableHead key={col} className="text-[11px] whitespace-nowrap">
                              {col}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.rows.map((row, ri) => (
                          <TableRow key={ri}>
                            {preview.columns.map((col) => (
                              <TableCell key={col} className="max-w-60 truncate text-xs">
                                {row[col] ?? ''}
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
