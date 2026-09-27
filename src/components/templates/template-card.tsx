'use client';

import { useTranslations } from 'next-intl';
import {
  AlertCircle,
  Copy,
  FileText,
  Film,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Megaphone,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  Type,
  Wrench,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { templateStatusConfig } from '@/lib/template-status';
import { templateLanguageName } from '@/lib/whatsapp/template-languages';
import type { MessageTemplate } from '@/types';

const CATEGORY_STYLE: Record<string, { icon: typeof Megaphone; tile: string; chip: string }> = {
  Marketing: {
    icon: Megaphone,
    tile: 'bg-purple-500/15 text-purple-500',
    chip: 'bg-purple-500/10 text-purple-600 dark:text-purple-300',
  },
  Utility: {
    icon: Wrench,
    tile: 'bg-sky-500/15 text-sky-500',
    chip: 'bg-sky-500/10 text-sky-600 dark:text-sky-300',
  },
  Authentication: {
    icon: KeyRound,
    tile: 'bg-amber-500/15 text-amber-500',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
  },
};

const STATUS_DOT: Record<string, string> = {
  APPROVED: 'bg-emerald-500',
  PENDING: 'bg-amber-500',
  IN_APPEAL: 'bg-amber-500',
  REJECTED: 'bg-red-500',
  PAUSED: 'bg-orange-500',
  DISABLED: 'bg-neutral-400',
  DRAFT: 'bg-neutral-400',
};

const HEADER_ICON: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  document: FileText,
  text: Type,
};

/**
 * One template in the Templates list: category tile, name + status,
 * body preview, and the actions its status allows — test-send and edit
 * for approved templates, resubmit for rejected/paused, clone and delete
 * for all.
 */
export function TemplateCard({
  template,
  deleting,
  onTest,
  onEdit,
  onClone,
  onDelete,
}: {
  template: MessageTemplate;
  deleting: boolean;
  onTest: () => void;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('Settings.templates');
  const statusKey = template.status || 'DRAFT';
  const status = templateStatusConfig[statusKey];
  const category = CATEGORY_STYLE[template.category] ?? CATEGORY_STYLE.Utility;
  const CategoryIcon = category.icon;
  const HeaderIcon = template.header_type ? HEADER_ICON[template.header_type] : null;
  const approved = statusKey === 'APPROVED';
  const fixable = statusKey === 'REJECTED' || statusKey === 'PAUSED';
  const problem = template.rejection_reason || template.submission_error;

  return (
    <article className="group flex gap-4 rounded-2xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-md sm:p-5">
      <div
        className={cn('hidden size-11 shrink-0 items-center justify-center rounded-xl sm:flex', category.tile)}
        aria-hidden
      >
        <CategoryIcon className="size-5" />
      </div>

      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <h3 className="truncate font-semibold text-foreground">{template.name}</h3>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium', status.classes)}>
                <span className={cn('size-1.5 rounded-full', STATUS_DOT[statusKey] ?? 'bg-neutral-400')} />
                {status.label}
              </span>
              <span className={cn('rounded-full px-2 py-0.5 font-medium', category.chip)}>{template.category}</span>
              {template.language ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground" title={template.language}>
                  {templateLanguageName(template.language)}
                </span>
              ) : null}
              {HeaderIcon ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
                  title={t('headerKindTitle', { kind: template.header_type ?? '' })}
                >
                  <HeaderIcon className="size-3" />
                  {template.header_type}
                </span>
              ) : null}
              {template.quality_score ? (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                    template.quality_score === 'GREEN'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : template.quality_score === 'YELLOW'
                        ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                        : 'bg-red-500/10 text-red-600 dark:text-red-400',
                  )}
                  title={t('qualityScoreTitle')}
                >
                  {template.quality_score}
                </span>
              ) : null}
            </div>
          </div>

          {/* Actions, grouped in one toolbar. */}
          <div className="flex items-center gap-0.5 rounded-xl border border-border bg-background p-0.5 shadow-xs">
            {approved ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onTest}
                title={t('testTitle')}
                aria-label={t('testLabel', { name: template.name })}
                className="h-8 gap-1.5 px-2.5 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400"
              >
                <Send className="size-3.5" />
                <span className="hidden md:inline">{t('sendTest')}</span>
              </Button>
            ) : null}
            {approved || fixable ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onEdit}
                title={approved ? t('editTitle') : t('resubmitTitle')}
                aria-label={approved ? t('editLabel') : t('resubmitLabel')}
                className="h-8 gap-1.5 px-2.5 text-muted-foreground hover:text-primary"
              >
                {approved ? <Pencil className="size-3.5" /> : <RotateCcw className="size-3.5" />}
                <span className="hidden md:inline">{approved ? t('edit') : t('resubmit')}</span>
              </Button>
            ) : null}
            {template.category !== 'Authentication' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClone}
                title={t('cloneTitle')}
                aria-label={t('cloneLabel', { name: template.name })}
                className="h-8 gap-1.5 px-2.5 text-muted-foreground hover:text-primary"
              >
                <Copy className="size-3.5" />
                <span className="hidden md:inline">{t('clone')}</span>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              disabled={deleting}
              title={template.meta_template_id ? t('deleteMetaLocallyTitle') : t('deleteLocallyTitle')}
              aria-label={template.meta_template_id ? t('deleteMetaLocallyAria') : t('deleteLocallyAria')}
              className="size-8 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </Button>
          </div>
        </div>

        {/* Body preview in a soft chat-style box. */}
        <div className="rounded-xl bg-muted/50 px-3 py-2">
          <p className="line-clamp-2 text-sm whitespace-pre-line text-foreground/90">{template.body_text}</p>
          {template.footer_text ? (
            <p className="mt-1 text-xs text-muted-foreground italic">{template.footer_text}</p>
          ) : null}
        </div>

        {problem ? (
          <div className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{problem}</span>
          </div>
        ) : null}
      </div>
    </article>
  );
}
