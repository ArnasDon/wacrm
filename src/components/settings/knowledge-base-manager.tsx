'use client';

// ============================================================
// KnowledgeBaseManager — Settings → AI Assistant → Knowledge base
//
// The "LLM wiki" the assistant is grounded in (spec §8 / §9.4). Lists
// every knowledge_base_entries row (title, ~token size, enabled
// toggle), supports add/edit (title + markdown content), delete, and
// file import (.txt / .md / .pdf → POST /api/ai/knowledge/upload).
//
// A size meter sums each entry's `token_estimate` against a soft
// 150k-token budget — the spec's signal that a KB has outgrown the
// "send the whole thing" approach and RAG should be turned on. The bar
// shifts amber as it nears the budget and red once over, mirroring the
// warning-band conventions used elsewhere in Settings.
//
// All CRUD goes through the /api/ai/knowledge routes (admin+ gated by
// the route + RLS). The upload route can answer 4xx (e.g. a 422 on a
// scanned PDF) with a human-readable `error` — we surface that verbatim
// via a sonner toast, matching template-manager's error pattern.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Loader2,
  Pencil,
  Upload,
  FileText,
  PenLine,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { KnowledgeBaseEntry } from '@/types';

// Soft budget the size meter measures against (spec §9.4). Not a hard
// cap — the assistant still sends the whole KB — but crossing it is the
// signal to enable RAG. The warning band opens at 80% of this.
const TOKEN_BUDGET = 150_000;
const WARN_FRACTION = 0.8;

// Matches the upload route's accepted extensions (spec §9.4).
const ACCEPTED_UPLOAD = '.txt,.md,.pdf';

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

interface EntryForm {
  title: string;
  content: string;
}

const emptyForm: EntryForm = { title: '', content: '' };

export function KnowledgeBaseManager() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<EntryForm>(emptyForm);
  // Non-null when editing an existing row — switches the dialog from
  // POST /knowledge to PATCH /knowledge/[id] and changes the title/CTA.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-row in-flight markers so a toggle/delete only spins its own row.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [entryToDelete, setEntryToDelete] =
    useState<KnowledgeBaseEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/knowledge', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to load knowledge base');
        return;
      }
      const data = (await res.json()) as { entries: KnowledgeBaseEntry[] };
      setEntries(data.entries);
    } catch (err) {
      console.error('[KnowledgeBaseManager] load error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Total + enabled-only token sums. The meter measures the *enabled*
  // total — that's what's actually fed to the model — while the row
  // count includes disabled entries.
  const { totalTokens, enabledTokens } = useMemo(() => {
    let total = 0;
    let enabled = 0;
    for (const e of entries) {
      const t = e.token_estimate ?? 0;
      total += t;
      if (e.enabled) enabled += t;
    }
    return { totalTokens: total, enabledTokens: enabled };
  }, [entries]);

  const pct = Math.min(100, (enabledTokens / TOKEN_BUDGET) * 100);
  const overBudget = enabledTokens > TOKEN_BUDGET;
  const nearBudget = !overBudget && enabledTokens >= TOKEN_BUDGET * WARN_FRACTION;

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(entry: KnowledgeBaseEntry) {
    setEditingId(entry.id);
    setForm({ title: entry.title, content: entry.content });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    const title = form.title.trim();
    const content = form.content.trim();
    if (!title) {
      toast.error('Give the entry a title');
      return;
    }
    if (!content) {
      toast.error('Entry content cannot be empty');
      return;
    }
    setSubmitting(true);
    try {
      const isEdit = editingId !== null;
      const res = await fetch(
        isEdit ? `/api/ai/knowledge/${editingId}` : '/api/ai/knowledge',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.error || `Save failed (HTTP ${res.status})`,
        );
      }
      const saved = data.entry as KnowledgeBaseEntry;
      setEntries((prev) =>
        isEdit
          ? prev.map((e) => (e.id === saved.id ? saved : e))
          : [saved, ...prev],
      );
      toast.success(isEdit ? 'Entry updated' : 'Entry added');
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save entry');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(entry: KnowledgeBaseEntry, next: boolean) {
    setTogglingId(entry.id);
    // Optimistic flip — revert on failure.
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, enabled: next } : e)),
    );
    try {
      const res = await fetch(`/api/ai/knowledge/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Update failed (HTTP ${res.status})`);
      }
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id ? (data.entry as KnowledgeBaseEntry) : e,
        ),
      );
    } catch (err) {
      // Revert the optimistic flip.
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id ? { ...e, enabled: entry.enabled } : e,
        ),
      );
      toast.error(err instanceof Error ? err.message : 'Failed to update entry');
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete() {
    const target = entryToDelete;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ai/knowledge/${target.id}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Delete failed (HTTP ${res.status})`);
      }
      setEntries((prev) => prev.filter((e) => e.id !== target.id));
      toast.success('Entry deleted');
      setEntryToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete entry');
    } finally {
      setDeleting(false);
    }
  }

  async function handleUploadFile(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/ai/knowledge/upload', {
        method: 'POST',
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Surface the route's human-readable error verbatim — e.g. the
        // 422 on a scanned/image-only PDF tells the user to paste the
        // text in manually (spec §9.4 fail-safe).
        throw new Error(data?.error || `Upload failed (HTTP ${res.status})`);
      }
      const saved = data.entry as KnowledgeBaseEntry;
      setEntries((prev) => [saved, ...prev]);
      toast.success(`Imported "${saved.title}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-foreground">
            Knowledge base
          </h3>
          <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
            The assistant answers strictly from these pages. Disabled
            entries are excluded from the prompt. Import a file or write
            a page by hand.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_UPLOAD}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUploadFile(f);
              e.target.value = ''; // allow re-picking the same file
            }}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Import a .txt, .md, or .pdf file"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {uploading ? 'Importing…' : 'Import file'}
          </Button>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            New entry
          </Button>
        </div>
      </div>

      {/* Size meter — enabled-token total vs. the soft budget. */}
      <Card>
        <CardContent className="space-y-2 py-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-foreground">
              Knowledge base size
            </span>
            <span
              className={cn(
                'text-sm font-medium tabular-nums',
                overBudget
                  ? 'text-red-400'
                  : nearBudget
                    ? 'text-amber-400'
                    : 'text-muted-foreground',
              )}
            >
              {fmtTokens(enabledTokens)} / {fmtTokens(TOKEN_BUDGET)} tokens
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={TOKEN_BUDGET}
            aria-valuenow={enabledTokens}
            aria-label="Knowledge base token usage"
          >
            <div
              className={cn(
                'h-full rounded-full transition-all',
                overBudget
                  ? 'bg-red-500'
                  : nearBudget
                    ? 'bg-amber-500'
                    : 'bg-primary',
              )}
              style={{ width: `${Math.max(pct, enabledTokens > 0 ? 2 : 0)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {overBudget ? (
              <span className="text-red-400">
                Over the {fmtTokens(TOKEN_BUDGET)}-token budget — replies
                cost more and may slow down. Trim entries, or this is the
                signal to switch to retrieval (RAG).
              </span>
            ) : nearBudget ? (
              <span className="text-amber-400">
                Nearing the {fmtTokens(TOKEN_BUDGET)}-token budget. Consider
                trimming or disabling lower-value entries.
              </span>
            ) : (
              <>
                Estimated from enabled entries (~4 characters per token).
                {totalTokens !== enabledTokens
                  ? ` ${fmtTokens(totalTokens)} total including disabled.`
                  : ''}
              </>
            )}
          </p>
        </CardContent>
      </Card>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <FileText className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No knowledge base entries yet.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add a page or import a file so the assistant has something
              to answer from.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'truncate text-sm font-medium',
                          entry.enabled
                            ? 'text-foreground'
                            : 'text-muted-foreground',
                        )}
                      >
                        {entry.title}
                      </span>
                      <Badge className="border-border bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
                        {entry.source_type === 'file' ? (
                          <>
                            <FileText className="size-2.5" />
                            File
                          </>
                        ) : (
                          <>
                            <PenLine className="size-2.5" />
                            Manual
                          </>
                        )}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {entry.content}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      ~{fmtTokens(entry.token_estimate ?? 0)} tokens
                      {entry.source_filename
                        ? ` · ${entry.source_filename}`
                        : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 self-start sm:self-auto">
                    <label className="flex items-center gap-2 pr-1 text-xs text-muted-foreground">
                      {togglingId === entry.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : null}
                      <Switch
                        checked={entry.enabled}
                        disabled={togglingId === entry.id}
                        onCheckedChange={(next) =>
                          handleToggle(entry, next === true)
                        }
                        aria-label={
                          entry.enabled ? 'Disable entry' : 'Enable entry'
                        }
                      />
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(entry)}
                      aria-label="Edit entry"
                      className="size-8 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEntryToDelete(entry)}
                      aria-label="Delete entry"
                      className="size-8 text-muted-foreground hover:bg-red-950/30 hover:text-red-400"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Add / edit dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-popover sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editingId ? 'Edit knowledge base entry' : 'New knowledge base entry'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Write a focused page (markdown supported). The assistant
              answers using the combined text of every enabled entry.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="kb-title" className="text-muted-foreground">
                Title
              </Label>
              <Input
                id="kb-title"
                placeholder="e.g. Refund policy"
                value={form.title}
                maxLength={200}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kb-content" className="text-muted-foreground">
                Content
              </Label>
              <Textarea
                id="kb-content"
                placeholder={'## Refunds\nWe offer refunds within 30 days of purchase…'}
                value={form.content}
                rows={12}
                maxLength={200_000}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                className="resize-y border-border bg-muted font-mono text-sm text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-[11px] text-muted-foreground tabular-nums">
                ~{fmtTokens(Math.ceil(form.content.trim().length / 4))} tokens
              </p>
            </div>
          </div>

          <DialogFooter className="border-border bg-popover">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {editingId ? 'Saving…' : 'Adding…'}
                </>
              ) : editingId ? (
                'Save changes'
              ) : (
                'Add entry'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm-delete dialog */}
      <Dialog
        open={entryToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setEntryToDelete(null);
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              Delete entry?
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              &quot;{entryToDelete?.title}&quot; will be removed from the
              knowledge base. The assistant will no longer use it. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-border bg-popover">
            <Button
              variant="outline"
              onClick={() => setEntryToDelete(null)}
              disabled={deleting}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
