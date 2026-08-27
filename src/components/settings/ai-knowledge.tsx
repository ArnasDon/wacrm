'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2, Plus, Trash2, Pencil, RefreshCw, BookOpen,
  Upload, Link as LinkIcon, FileSpreadsheet, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DocSummary {
  id: string;
  title: string;
  updated_at: string;
  type: string;
  metadata: Record<string, unknown> | null;
}

/** Editor target: 'new' when creating, a doc id when editing, null when closed. */
type EditTarget = 'new' | string | null;

// ---- Inventory uploader types ----//
interface DetectedColumnMap {
  sku: string | null;
  name: string | null;
  price: string | null;
  stock: string | null;
  category: string | null;
}

interface InventoryPreview {
  sample: Record<string, string>[];
  detected: DetectedColumnMap;
}

interface LegacyDataSource {
  id: string;
  source_type: 'google_sheets' | 'remote_csv' | 'uploaded_csv';
  row_count: number | null;
}

function InventoryUploader({
  canEdit,
  onRefresh,
}: {
  canEdit: boolean;
  onRefresh: () => Promise<void>;
}) {
  const t = useTranslations('Settings.aiKnowledge');
  const [mode, setMode] = useState<'file' | 'sheet' | null>(null);
  const [preview, setPreview] = useState<InventoryPreview | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  // The inventory upload is now backed by the unified Data Sources
  // pipeline (a single ai_data_sources row flagged is_legacy_default —
  // see AI_Catalog_Fix_Kit FASE 2/3), not a KB document, so "is there
  // already an inventory loaded" is answered by fetching THAT row
  // rather than filtering the generic Knowledge Base document list.
  const [legacySource, setLegacySource] = useState<LegacyDataSource | null>(null);
  const [legacyLoading, setLegacyLoading] = useState(true);

  const fetchLegacySource = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/data-sources');
      const data = await res.json().catch(() => ({}));
      const rows = Array.isArray(data.data_sources) ? data.data_sources : [];
      const found = rows.find((r: { is_legacy_default?: boolean }) => r.is_legacy_default);
      setLegacySource(found ?? null);
    } catch {
      setLegacySource(null);
    } finally {
      setLegacyLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLegacySource();
  }, [fetchLegacySource]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split('.').pop();
    if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
      toast.error('Unsupported format. Please upload a CSV or Excel (.xlsx) file.');
      return;
    }
    setMode('file');
    setLoading(true);
    const fd = new FormData();
    fd.append('file', file);
    fetch('/api/ai/knowledge/inventory/preview', { method: 'POST', body: fd })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setPreview(data.preview);
          setMetadata(data.metadata);
        } else {
          toast.error(data.error ?? 'Preview failed.');
          setMode(null);
        }
      })
      .catch(() => { toast.error('Preview failed.'); setMode(null); })
      .finally(() => setLoading(false));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if we're leaving the dropzone itself (not a child)
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const allColumns = preview?.sample.length
    ? Object.keys(preview.sample[0])
    : [];

  // Reset selected columns whenever a new preview arrives.
  useEffect(() => {
    if (preview) setSelectedColumns(allColumns);
  }, [preview]);

  const sourceLabel = (src: LegacyDataSource['source_type']) => {
    const map: Record<LegacyDataSource['source_type'], string> = {
      uploaded_csv: t('inventorySourceCsv'),
      remote_csv: t('inventorySourceCsv'),
      google_sheets: t('inventorySourceSheet'),
    };
    return map[src] ?? src;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMode('file');
    setLoading(true);
    const fd = new FormData();
    fd.append('file', file);
    fetch('/api/ai/knowledge/inventory/preview', { method: 'POST', body: fd })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setPreview(data.preview);
          setMetadata(data.metadata);
        } else {
          toast.error(data.error ?? 'Preview failed.');
          setMode(null);
        }
      })
      .catch(() => { toast.error('Preview failed.'); setMode(null); })
      .finally(() => setLoading(false));
  };

  const fetchSheetPreview = async () => {
    if (!sheetUrl.trim()) return;
    setMode('sheet');
    setLoading(true);
    try {
      const res = await fetch('/api/ai/knowledge/inventory/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sheetUrl.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setPreview(data.preview);
        setMetadata(data.metadata);
      } else {
        toast.error(data.error ?? t('sheetFetchFailed'));
        setMode(null);
      }
    } catch {
      toast.error(t('sheetFetchFailed'));
      setMode(null);
    } finally {
      setLoading(false);
    }
  };

  const toggleColumn = (col: string) => {
    setSelectedColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  };

  const confirmUpload = async () => {
    setUploading(true);
    try {
      if (mode === 'file') {
        const file = fileRef.current?.files?.[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        fd.append('selectedColumns', JSON.stringify(selectedColumns));
        const res = await fetch('/api/ai/knowledge/upload', { method: 'POST', body: fd });
        const data = await res.json();
        if (res.ok) {
          if (data.warning) toast.warning(data.warning);
          else toast.success(t('uploadSuccess'));
        } else {
          toast.error(data.error ?? t('uploadFailed'));
          return;
        }
      } else if (mode === 'sheet') {
        const res = await fetch('/api/ai/knowledge/sheet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: sheetUrl.trim(), selectedColumns }),
        });
        const data = await res.json();
        if (res.ok) {
          if (data.warning) toast.warning(data.warning);
          else toast.success(t('uploadSuccess'));
        } else {
          toast.error(data.error ?? t('uploadFailed'));
          return;
        }
      }
      setPreview(null);
      setMetadata(null);
      setMode(null);
      setSheetUrl('');
      setSelectedColumns([]);
      if (fileRef.current) fileRef.current.value = '';
      await Promise.all([onRefresh(), fetchLegacySource()]);
    } catch {
      toast.error(t('uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const deleteInventory = async () => {
    try {
      const res = await fetch('/api/ai/knowledge/inventory', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('inventoryDeleteSuccess'));
        await Promise.all([onRefresh(), fetchLegacySource()]);
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('inventoryDeleteFailed'));
      }
    } catch {
      toast.error(t('inventoryDeleteFailed'));
    }
  };

  const detectedEntries: { key: keyof DetectedColumnMap; label: string }[] = [
    { key: 'sku', label: t('detectedSku') },
    { key: 'name', label: t('detectedName') },
    { key: 'price', label: t('detectedPrice') },
    { key: 'stock', label: t('detectedStock') },
    { key: 'category', label: t('detectedCategory') },
  ];

  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FileSpreadsheet className="h-4 w-4 text-primary" />
        {t('inventoryHeading')}
      </div>
      <p className="text-xs text-muted-foreground">{t('inventoryDesc')}</p>

      {legacySource && (
        <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs">
          <span>
            {t('inventoryStatus', {
              rows: legacySource.row_count ?? '?',
              source: sourceLabel(legacySource.source_type),
            })}
          </span>
          {canEdit && (
            <Button variant="ghost" size="sm" className="h-7 text-destructive text-xs" onClick={deleteInventory}>
              <Trash2 className="mr-1 h-3 w-3" /> {t('inventoryDelete')}
            </Button>
          )}
        </div>
      )}

      {!legacySource && !legacyLoading && canEdit && !preview && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          className={cn(
            'space-y-2 rounded-lg border-2 border-dashed p-4 transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-border/60 hover:border-primary/40',
          )}
        >
          <p className="text-center text-xs text-muted-foreground">
            {isDragging ? 'Drop your file here' : 'Drag & drop or click to upload'}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="text-xs">
              <Upload className="mr-1 h-3 w-3" /> {t('uploadFile')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('uploadFileHint')}</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="flex items-center gap-2">
            <Input
              placeholder={t('sheetUrlPlaceholder')}
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              className="h-7 text-xs"
            />
            <Button variant="outline" size="sm" onClick={fetchSheetPreview} disabled={!sheetUrl.trim() || loading} className="text-xs shrink-0">
              {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <LinkIcon className="mr-1 h-3 w-3" />}
              {loading ? t('fetchingSheet') : t('fetchSheet')}
            </Button>
          </div>
        </div>
      )}

      {/* Preview dialog */}
      <Dialog open={preview !== null} onOpenChange={(open) => { if (!open) { setPreview(null); setMetadata(null); setMode(null); setSelectedColumns([]); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('previewTitle')}</DialogTitle>
            <DialogDescription>{t('previewDesc')}</DialogDescription>
          </DialogHeader>

          {preview && (
            <div className="space-y-3 overflow-y-auto flex-1 min-h-0">
              <div className="max-h-28 overflow-y-auto">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {detectedEntries.map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-1">
                      <span className="text-muted-foreground shrink-0">{label}:</span>
                      <span className={preview.detected[key] ? 'font-medium text-foreground truncate' : 'text-destructive shrink-0'}>
                        {preview.detected[key] ?? t('notDetected')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Column checkboxes */}
              {allColumns.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-1">{t('selectColumns')}</p>
                  <div className="max-h-36 overflow-y-auto flex flex-wrap gap-x-4 gap-y-1">
                    {allColumns.map((col) => (
                      <label
                        key={col}
                        className="flex items-center gap-1 text-xs cursor-pointer whitespace-nowrap"
                      >
                        <input
                          type="checkbox"
                          checked={selectedColumns.includes(col)}
                          onChange={() => toggleColumn(col)}
                          className="h-3 w-3 shrink-0"
                        />
                        <span className="truncate max-w-56">{col}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-medium mb-1">{t('sampleRows')}</p>
                <div className="overflow-x-auto rounded-md border border-border">
                  <div className="max-h-60 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/50">
                          {metadata && (metadata.columns as string[]).map((col) => (
                            <th key={col} className="px-2 py-1 text-left font-medium text-muted-foreground whitespace-nowrap">{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.sample.map((row, ri) => (
                          <tr key={ri} className="border-t border-border">
                            {metadata && (metadata.columns as string[]).map((col) => (
                              <td key={col} className="px-2 py-1 text-foreground max-w-60 overflow-hidden text-ellipsis">{row[col] ?? ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setPreview(null); setMetadata(null); setMode(null); setSelectedColumns([]); }} disabled={uploading}>
              {t('cancel')}
            </Button>
            <Button onClick={confirmUpload} disabled={uploading}>
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {selectedColumns.length === 0 ? t('selectAtLeastOne') : t('confirmUpload')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function AiKnowledgeCard({
  accountId,
  canEdit,
  hasEmbeddingsKey,
}: {
  accountId: string | null;
  canEdit: boolean;
  hasEmbeddingsKey: boolean;
}) {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const loadedAccountIdRef = useRef<string | null>(null);
  const t = useTranslations('Settings.aiKnowledge');

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/knowledge');
      const data = await res.json();
      if (res.ok) setDocs(data.documents ?? []);
      else toast.error(data.error ?? t('loadFailed'));
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchDocs();
  }, [accountId, fetchDocs]);

  const openNew = () => {
    setEditing('new');
    setTitle('');
    setContent('');
  };

  const openEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('openFailed'));
        return;
      }
      setEditing(id);
      setTitle(data.title ?? '');
      setContent(data.content ?? '');
    } catch {
      toast.error(t('openFailed'));
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setTitle('');
    setContent('');
  };

  const save = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error(t('titleContentRequired'));
      return;
    }
    setSaving(true);
    try {
      const isNew = editing === 'new';
      const res = await fetch(
        isNew ? '/api/ai/knowledge' : `/api/ai/knowledge/${editing}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), content: content.trim() }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        // A 200 with `warning` means saved but indexing degraded.
        if (data.warning) toast.warning(data.warning);
        else toast.success(isNew ? t('saveSuccessNew') : t('saveSuccessUpdate'));
        cancelEdit();
        await fetchDocs();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setDocs((d) => d.filter((x) => x.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    }
  };

  const uploadPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPdf(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/ai/knowledge/upload-pdf', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok) {
        if (data.warning) toast.warning(data.warning);
        else toast.success(t('uploadPdfSuccess'));
        await fetchDocs();
      } else {
        toast.error(data.error ?? t('uploadPdfFailed'));
      }
    } catch {
      toast.error(t('uploadPdfFailed'));
    } finally {
      setUploadingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const res = await fetch('/api/ai/knowledge/reindex', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(t('reindexSuccess', { count: data.reindexed }));
      } else {
        toast.error(data.error ?? t('reindexFailed'));
      }
    } catch {
      toast.error(t('reindexFailed'));
    } finally {
      setReindexing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>
          {t('description', {
            searchType: hasEmbeddingsKey ? t('semanticSearchOn') : t('keywordSearchOn')
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : (
          <>
            {docs.length === 0 && editing === null && (
              <p className="text-sm text-muted-foreground">
                {t('noDocs')}
              </p>
            )}

            {docs.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm text-foreground">
                      {doc.title}
                    </span>
                    {canEdit && (
                      <span className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => void openEdit(doc.id)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => void remove(doc.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {editing !== null ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="space-y-2">
                  <Label htmlFor="kb-title">{t('editDocTitle')}</Label>
                  <Input
                    id="kb-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('editDocTitlePlaceholder')}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="kb-content">{t('editDocContent')}</Label>
                  <Textarea
                    id="kb-content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t('editDocContentPlaceholder')}
                    rows={8}
                    disabled={saving}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
                    {t('cancel')}
                  </Button>
                  <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t('saveDoc')}
                  </Button>
                </div>
              </div>
            ) : (
              canEdit && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={openNew}>
                      <Plus className="mr-2 h-4 w-4" /> {t('addDoc')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => pdfInputRef.current?.click()} disabled={uploadingPdf} className="text-xs">
                      {uploadingPdf ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
                      {t('uploadPdf')}
                    </Button>
                    <input
                      ref={pdfInputRef}
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={uploadPdf}
                    />
                  </div>
                  {hasEmbeddingsKey && docs.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={reindex}
                      disabled={reindexing}
                      title={t('reindexTooltip')}
                    >
                      {reindexing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      {t('reindex')}
                    </Button>
                  )}
                </div>
              )
            )}
          </>
        )}

        {!loading && (
          <InventoryUploader
            canEdit={canEdit}
            onRefresh={fetchDocs}
          />
        )}
      </CardContent>
    </Card>
  );
}
