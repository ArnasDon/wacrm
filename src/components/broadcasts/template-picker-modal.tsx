'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, CheckCircle2, Loader2, FileText } from 'lucide-react';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { categoryColors } from './template-category-colors';

const CATEGORY_FILTERS = ['all', 'Marketing', 'Utility'] as const;
type CategoryFilter = (typeof CATEGORY_FILTERS)[number];

interface TemplatePickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: MessageTemplate[];
  loading: boolean;
  error: string | null;
  selectedTemplate: MessageTemplate | null;
  onConfirm: (template: MessageTemplate) => void;
}

/**
 * Modal template picker (spec section B3) — replaces the inline grid
 * that used to render directly on Step 1. Selecting a card only stages
 * `pendingId`; the parent's `selectedTemplate` is only updated on
 * "Confirmar Seleção", so closing/cancelling never mutates the wizard's
 * actual selection mid-browse.
 */
export function TemplatePickerModal({
  open,
  onOpenChange,
  templates,
  loading,
  error,
  selectedTemplate,
  onConfirm,
}: TemplatePickerModalProps) {
  const t = useTranslations('Campaigns.wizard.chooseTemplate');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Reset local filter/selection state every time the modal opens.
  // Legitimate prop-driven sync, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setSearch('');
    setCategory('all');
    setPendingId(selectedTemplate?.id ?? null);
  }, [open, selectedTemplate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesCategory = category === 'all' || template.category === category;
      const matchesSearch =
        !q ||
        template.name.toLowerCase().includes(q) ||
        template.body_text.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [templates, search, category]);

  function handleConfirm() {
    const template = templates.find((tpl) => tpl.id === pendingId);
    if (!template) return;
    onConfirm(template);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('templateModal.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('templateModal.searchPlaceholder')}
              className="border-border bg-muted pl-9 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_FILTERS.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  category === c
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card/50 text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(`templateModal.category${c === 'all' ? 'All' : c}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card/50">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {templates.length === 0 ? t('noTemplates') : t('templateModal.noResults')}
              </p>
              {templates.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('createFirst')}</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filtered.map((template) => {
                const isPending = pendingId === template.id;
                const catColor = categoryColors[template.category] ?? categoryColors.Utility;

                return (
                  <button
                    key={template.id}
                    onClick={() => setPendingId(template.id)}
                    className={`flex flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
                      isPending
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border bg-card/50 hover:border-border hover:bg-card'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-medium text-foreground">{template.name}</h3>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${catColor}`}
                        >
                          {template.category}
                        </span>
                        {isPending && <CheckCircle2 className="h-4 w-4 text-primary" />}
                      </div>
                    </div>
                    <p className="line-clamp-3 text-xs text-muted-foreground">
                      {template.body_text}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{template.language ?? 'en_US'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground"
          >
            {t('templateModal.cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!pendingId}
            className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {t('templateModal.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
