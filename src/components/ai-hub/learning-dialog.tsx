'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Ban, Check, Loader2, Pencil, Repeat } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AiSuggestion } from '@/types';

interface LearningPayload {
  type?: string;
  info?: string;
  context_summary?: string | null;
  application?: string | null;
  occurrence_count?: number;
  origin?: string | null;
}

const LEARNING_TYPES = [
  'factual',
  'commercial_rule',
  'procedure',
  'communication_style',
  'template_usage',
  'followup_pattern',
  'other',
] as const;

export function LearningDialog({
  suggestion,
  open,
  onOpenChange,
  onResolved,
}: {
  suggestion: AiSuggestion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved: () => void;
}) {
  const t = useTranslations('AiHub.learning');
  const { accountRole } = useAuth();
  const canApprove = accountRole ? canEditSettings(accountRole) : false;
  const payload = (suggestion.payload ?? {}) as LearningPayload;

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(payload.info ?? suggestion.title);
  const [contextSummary, setContextSummary] = useState(payload.context_summary ?? '');
  const [application, setApplication] = useState(payload.application ?? '');

  const learningType = LEARNING_TYPES.includes(payload.type as (typeof LEARNING_TYPES)[number])
    ? (payload.type as (typeof LEARNING_TYPES)[number])
    : 'other';

  const save = useCallback(
    async (extra: { status?: 'approved' | 'rejected' } = {}) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/suggestions/${suggestion.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: extra.status ?? 'pending',
            learning_edit: {
              info,
              context_summary: contextSummary,
              application,
            },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed');

        if (extra.status === 'approved') {
          toast.success(t('approved'));
          onResolved();
          onOpenChange(false);
        } else if (extra.status === 'rejected') {
          toast.success(t('rejected'));
          onResolved();
          onOpenChange(false);
        } else {
          toast.success(t('saved'));
          setEditing(false);
          onResolved();
        }
      } catch {
        toast.error(t('actionError'));
      } finally {
        setBusy(false);
      }
    },
    [suggestion.id, info, contextSummary, application, t, onResolved, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t(`types.${learningType}`)}</DialogDescription>
        </DialogHeader>

        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('info')}</Label>
              <Textarea value={info} onChange={(e) => setInfo(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('context')}</Label>
              <Textarea
                value={contextSummary}
                onChange={(e) => setContextSummary(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('application')}</Label>
              <Textarea
                value={application}
                onChange={(e) => setApplication(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t('info')}</p>
              <p className="text-foreground">{info}</p>
            </div>
            {contextSummary && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t('context')}</p>
                <p className="text-foreground">{contextSummary}</p>
              </div>
            )}
            {application && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t('application')}</p>
                <p className="text-foreground">{application}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-4">
              {typeof payload.occurrence_count === 'number' && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('occurrences')}</p>
                  <p className="flex items-center gap-1 text-foreground">
                    <Repeat className="h-3.5 w-3.5" />
                    {payload.occurrence_count}
                  </p>
                </div>
              )}
              {payload.origin && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{t('origin')}</p>
                  <p className="text-foreground">{payload.origin}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          {editing ? (
            <>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                {t('cancel')}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => save()}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {t('save')}
              </Button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" /> {t('edit')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => save({ status: 'rejected' })}
                >
                  <Ban className="h-3.5 w-3.5" /> {t('reject')}
                </Button>
              </div>
              <Button
                size="sm"
                disabled={busy || !canApprove}
                title={canApprove ? undefined : t('approveAdminOnly')}
                onClick={() => save({ status: 'approved' })}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {t('approve')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
