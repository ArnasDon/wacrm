'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BrainCircuit, CheckCheck, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { SuggestionCard } from '@/components/ai-hub/suggestion-card';
import {
  AI_SUGGESTION_CATEGORIES,
  aiSuggestionCategoryConfig,
} from '@/lib/ai-suggestion-status';
import type { AiSuggestion, AiSuggestionCategory, AiSuggestionStatus } from '@/types';

type StatusFilter = AiSuggestionStatus;
type CategoryFilter = AiSuggestionCategory | 'all';

const STATUS_FILTERS: StatusFilter[] = [
  'pending',
  'approved',
  'rejected',
  'ignored',
  'done',
];

export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <AgentsPageInner />
    </Suspense>
  );
}

function AgentsPageInner() {
  const t = useTranslations('AiHub');
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep-link from the Inbox's discreet "pending suggestions" hint
  // (contact-sidebar.tsx) — `?contact=<id>` prefilters to that lead.
  const contactFilter = searchParams.get('contact');
  const [suggestions, setSuggestions] = useState<AiSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: statusFilter });
      if (contactFilter) params.set('contactId', contactFilter);
      const res = await fetch(`/api/ai/suggestions?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to load');
      setSuggestions((data.suggestions ?? []) as AiSuggestion[]);
      setError(null);
    } catch {
      setError(t('loadError'));
    }
  }, [statusFilter, contactFilter, t]);

  const clearContactFilter = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('contact');
    router.replace(`/agents${params.toString() ? `?${params.toString()}` : ''}`, {
      scroll: false,
    });
  }, [router, searchParams]);

  useEffect(() => {
    load();
  }, [load]);

  const patchSuggestion = useCallback(async (id: string, status: AiSuggestionStatus) => {
    const res = await fetch(`/api/ai/suggestions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Failed to update');
  }, []);

  const updateStatus = useCallback(
    async (id: string, status: AiSuggestionStatus) => {
      // Optimistic — the item drops out of the current (pending) view
      // immediately rather than waiting on the round-trip.
      setSuggestions((prev) => prev?.filter((s) => s.id !== id) ?? prev);
      try {
        await patchSuggestion(id, status);
        toast.success(t('toastUpdated'));
      } catch {
        toast.error(t('toastError'));
        load();
      }
    },
    [load, patchSuggestion, t],
  );

  const counts = AI_SUGGESTION_CATEGORIES.reduce<Record<string, number>>(
    (acc, cat) => {
      acc[cat] = suggestions?.filter((s) => s.category === cat).length ?? 0;
      return acc;
    },
    {},
  );

  const visible =
    categoryFilter === 'all'
      ? suggestions
      : suggestions?.filter((s) => s.category === categoryFilter);

  // "Aceitar todas as movimentações" (section 12) — pipeline_move only,
  // never mixed with other categories. Only meaningful while looking at
  // the pending view, since that's the only status the button acts on.
  const pendingPipelineMoves = useMemo(
    () =>
      statusFilter === 'pending'
        ? (suggestions ?? []).filter((s) => s.category === 'pipeline_move')
        : [],
    [statusFilter, suggestions],
  );
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);

  const runBulkAccept = useCallback(async () => {
    setBulkRunning(true);
    const targets = pendingPipelineMoves;
    let failed = 0;
    // Sequential, not parallel — each acceptance is recorded as its own
    // decision (section 12) and moves a real deal; running them one at a
    // time keeps that audit trail honest and avoids hammering the
    // provider-agnostic deals table with concurrent writes.
    for (const s of targets) {
      try {
        await patchSuggestion(s.id, 'approved');
        setSuggestions((prev) => prev?.filter((x) => x.id !== s.id) ?? prev);
      } catch {
        failed += 1;
      }
    }
    setBulkRunning(false);
    setBulkConfirmOpen(false);
    if (failed === 0) {
      toast.success(t('bulkAcceptSuccess', { count: targets.length }));
    } else {
      toast.error(t('bulkAcceptPartial', { failed, total: targets.length }));
      load();
    }
  }, [pendingPipelineMoves, patchSuggestion, load, t]);

  return (
    <div>
      <div className="flex items-center gap-2">
        <BrainCircuit className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('title')}
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>

      {contactFilter && (
        <button
          type="button"
          onClick={clearContactFilter}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
        >
          {suggestions?.[0]?.contact?.name ?? t('filteredByContact')}
          <X className="h-3 w-3" />
        </button>
      )}

      {/* Category filter row — also doubles as an at-a-glance count of
          what's pending in each bucket, so a category with nothing
          pending is visually quiet without needing a separate summary. */}
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <button
          type="button"
          onClick={() => setCategoryFilter('all')}
          className={cn(
            'rounded-xl border p-3 text-left transition-colors',
            categoryFilter === 'all'
              ? 'border-primary/40 bg-primary/5'
              : 'border-border bg-card hover:border-border/70',
          )}
        >
          <p className="text-xs font-medium text-muted-foreground">{t('allCategories')}</p>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {suggestions?.length ?? '–'}
          </p>
        </button>
        {AI_SUGGESTION_CATEGORIES.map((cat) => {
          const meta = aiSuggestionCategoryConfig[cat];
          const Icon = meta.icon;
          const isActive = categoryFilter === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors',
                isActive
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card hover:border-border/70',
              )}
            >
              <Icon
                className={cn('h-4 w-4', isActive ? 'text-primary' : 'text-muted-foreground')}
              />
              <p className="mt-1.5 truncate text-xs font-medium text-muted-foreground">
                {t(`categories.${meta.labelKey}`)}
              </p>
              <p className="mt-0.5 text-lg font-semibold text-foreground">
                {counts[cat]}
              </p>
            </button>
          );
        })}
      </div>

      {/* Status filter — plain buttons rather than the Tabs primitive
          since it's a single flat row with no per-tab panel markup. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={statusFilter === s ? 'default' : 'outline'}
              onClick={() => setStatusFilter(s)}
            >
              {t(`status.${s}`)}
            </Button>
          ))}
        </div>
        {pendingPipelineMoves.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setBulkConfirmOpen(true)}>
            <CheckCheck className="h-3.5 w-3.5" />
            {t('bulkAcceptButton')}
          </Button>
        )}
      </div>

      <Dialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('bulkAcceptTitle')}</DialogTitle>
            <DialogDescription>
              {t('bulkAcceptConfirm', { count: pendingPipelineMoves.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={bulkRunning} onClick={() => setBulkConfirmOpen(false)}>
              {t('bulkAcceptCancel')}
            </Button>
            <Button disabled={bulkRunning} onClick={runBulkAccept}>
              {bulkRunning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('bulkAcceptConfirmBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mt-4">
        {error ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/40">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={load}>
              {t('retry')}
            </Button>
          </div>
        ) : suggestions === null ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : visible && visible.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {visible.map((s) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                onUpdateStatus={updateStatus}
                onRefresh={load}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <BrainCircuit className="h-6 w-6 text-primary" />
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">
              {t('emptyTitle')}
            </p>
            <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground">
              {t('emptyDesc')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
