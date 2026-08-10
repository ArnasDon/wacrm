'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Ban,
  Check,
  Clock,
  Copy,
  Loader2,
  MessageSquare,
  RotateCcw,
  ShoppingBag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { writeFollowupDraft } from '@/lib/inbox/followup-draft';
import type { AiSuggestion } from '@/types';

/** Default "Adiar" window — a single click, no duration picker, kept
 *  here so it's a one-line change later if it needs to become
 *  user-configurable. */
const SNOOZE_DAYS = 3;

interface FollowupPayload {
  stage_name?: string | null;
  has_purchased?: boolean;
  hours_since_contact?: number;
  reason?: string | null;
  approach_summary?: string | null;
  score?: number | null;
  draft?:
    | { mode: 'free'; text: string }
    | {
        mode: 'template';
        template_id: string;
        template_name: string;
        body_text: string;
        values: { body: string[]; headerText?: string };
      };
}

type Step = 'review' | 'choose_mode' | 'free_draft' | 'template_draft' | 'no_template';

function renderTemplatePreview(body: string, values: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return values[idx]?.trim() || `{{${raw}}}`;
  });
}

export function FollowupDialog({
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
  const t = useTranslations('AiHub.followup');
  const router = useRouter();
  const payload = (suggestion.payload ?? {}) as FollowupPayload;

  // Resume straight into the draft screen if one was already generated
  // (page reload, or reopening the dialog) instead of asking the user
  // to pick a mode again.
  const [step, setStep] = useState<Step>(
    payload.draft?.mode === 'free'
      ? 'free_draft'
      : payload.draft?.mode === 'template'
        ? 'template_draft'
        : 'review',
  );
  const [busy, setBusy] = useState(false);
  const [freeText, setFreeText] = useState(
    payload.draft?.mode === 'free' ? payload.draft.text : '',
  );
  const [templateValues, setTemplateValues] = useState<string[]>(
    payload.draft?.mode === 'template' ? payload.draft.values.body : [],
  );
  const [templateDraft, setTemplateDraft] = useState(
    payload.draft?.mode === 'template' ? payload.draft : null,
  );

  const generate = useCallback(
    async (mode: 'free' | 'template') => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/suggestions/${suggestion.id}/followup/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Failed to generate');

        if (mode === 'free') {
          setFreeText(data.draft?.text ?? '');
          setStep('free_draft');
        } else if (data.draft) {
          setTemplateDraft(data.draft);
          setTemplateValues(data.draft.values.body);
          setStep('template_draft');
        } else {
          setStep('no_template');
        }
      } catch {
        toast.error(t('generateError'));
      } finally {
        setBusy(false);
      }
    },
    [suggestion.id, t],
  );

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(freeText);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyError'));
    }
  }, [freeText, t]);

  const goToConversationTemplate = useCallback(() => {
    if (!suggestion.conversation_id || !templateDraft) return;
    writeFollowupDraft(suggestion.conversation_id, {
      suggestionId: suggestion.id,
      mode: 'template',
      templateId: templateDraft.template_id,
      values: { body: templateValues, headerText: templateDraft.values.headerText },
    });
    onOpenChange(false);
    router.push(`/inbox?c=${suggestion.conversation_id}`);
  }, [suggestion.conversation_id, suggestion.id, templateDraft, templateValues, onOpenChange, router]);

  const complete = useCallback(
    async (mode: 'whatsapp' | 'crm') => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/suggestions/${suggestion.id}/followup/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            message: mode === 'whatsapp' ? freeText : undefined,
            template_id: mode === 'crm' ? templateDraft?.template_id : undefined,
          }),
        });
        if (!res.ok) throw new Error();
        toast.success(t('markedDone'));
        onResolved();
        onOpenChange(false);
      } catch {
        toast.error(t('markDoneError'));
      } finally {
        setBusy(false);
      }
    },
    [suggestion.id, freeText, templateDraft, t, onResolved, onOpenChange],
  );

  const act = useCallback(
    async (status: 'ignored') => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/suggestions/${suggestion.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) throw new Error();
        onResolved();
        onOpenChange(false);
      } catch {
        toast.error(t('actionError'));
      } finally {
        setBusy(false);
      }
    },
    [suggestion.id, t, onResolved, onOpenChange],
  );

  const snooze = useCallback(async () => {
    setBusy(true);
    try {
      const until = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const res = await fetch(`/api/ai/suggestions/${suggestion.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending', snoozed_until: until }),
      });
      if (!res.ok) throw new Error();
      toast.success(t('snoozed', { days: SNOOZE_DAYS }));
      onResolved();
      onOpenChange(false);
    } catch {
      toast.error(t('actionError'));
    } finally {
      setBusy(false);
    }
  }, [suggestion.id, t, onResolved, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{suggestion.contact?.name ?? t('title')}</DialogTitle>
          <DialogDescription>{t('title')}</DialogDescription>
        </DialogHeader>

        {step === 'review' && (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {payload.stage_name && (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('stage')}</dt>
                  <dd className="text-foreground">{payload.stage_name}</dd>
                </div>
              )}
              {payload.has_purchased !== undefined && (
                <div>
                  <dt className="text-xs text-muted-foreground">{t('hasPurchased')}</dt>
                  <dd className="flex items-center gap-1 text-foreground">
                    <ShoppingBag className="h-3.5 w-3.5" />
                    {payload.has_purchased ? t('yes') : t('no')}
                  </dd>
                </div>
              )}
              {typeof payload.hours_since_contact === 'number' && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">{t('lastContact')}</dt>
                  <dd className="flex items-center gap-1 text-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {t('hoursAgo', { hours: payload.hours_since_contact })}
                  </dd>
                </div>
              )}
            </dl>
            {payload.reason && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t('reason')}</p>
                <p className="text-sm text-foreground">{payload.reason}</p>
              </div>
            )}
            {payload.approach_summary && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t('approach')}</p>
                <p className="text-sm text-foreground">{payload.approach_summary}</p>
              </div>
            )}
          </div>
        )}

        {step === 'choose_mode' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => generate('free')}
              className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-center transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
            >
              <Copy className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium text-foreground">{t('modeWhatsApp')}</span>
              <span className="text-xs text-muted-foreground">{t('modeWhatsAppDesc')}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => generate('template')}
              className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-center transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
            >
              <MessageSquare className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium text-foreground">{t('modeCrm')}</span>
              <span className="text-xs text-muted-foreground">{t('modeCrmDesc')}</span>
            </button>
            {busy && (
              <div className="col-span-2 flex justify-center py-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
            )}
          </div>
        )}

        {step === 'free_draft' && (
          <div className="space-y-2">
            <Label className="text-xs">{t('messagePreview')}</Label>
            <Textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              rows={6}
              className="text-sm"
            />
          </div>
        )}

        {step === 'template_draft' && templateDraft && (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-xs text-muted-foreground">
                {t('templateUsed')}: {templateDraft.template_name}
              </p>
              <p className="whitespace-pre-wrap text-foreground">
                {renderTemplatePreview(templateDraft.body_text, templateValues)}
              </p>
            </div>
            {templateValues.map((v, i) => (
              <div key={i} className="space-y-1">
                <Label className="text-xs">{`{{${i + 1}}}`}</Label>
                <Input
                  value={v}
                  onChange={(e) => {
                    const next = [...templateValues];
                    next[i] = e.target.value;
                    setTemplateValues(next);
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {step === 'no_template' && (
          <p className="text-sm text-muted-foreground">{t('noTemplate')}</p>
        )}

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          {step === 'review' && (
            <>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => act('ignored')}>
                  <Ban className="h-3.5 w-3.5" /> {t('ignore')}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={snooze}>
                  <Clock className="h-3.5 w-3.5" /> {t('snooze')}
                </Button>
                {suggestion.conversation_id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    render={<a href={`/inbox?c=${suggestion.conversation_id}`} />}
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> {t('viewConversation')}
                  </Button>
                )}
              </div>
              <Button size="sm" disabled={busy} onClick={() => setStep('choose_mode')}>
                <Check className="h-3.5 w-3.5" /> {t('accept')}
              </Button>
            </>
          )}

          {step === 'choose_mode' && (
            <Button variant="outline" size="sm" onClick={() => setStep('review')}>
              {t('back')}
            </Button>
          )}

          {step === 'free_draft' && (
            <>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => generate('free')}>
                <RotateCcw className="h-3.5 w-3.5" /> {t('regenerate')}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={copyToClipboard}>
                  <Copy className="h-3.5 w-3.5" /> {t('copyButton')}
                </Button>
                <Button size="sm" disabled={busy} onClick={() => complete('whatsapp')}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t('markDone')}
                </Button>
              </div>
            </>
          )}

          {step === 'template_draft' && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => generate('template')}
              >
                <RotateCcw className="h-3.5 w-3.5" /> {t('regenerate')}
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => complete('crm')}>
                  {t('markDone')}
                </Button>
                <Button size="sm" disabled={busy} onClick={goToConversationTemplate}>
                  <MessageSquare className="h-3.5 w-3.5" /> {t('goToConversation')}
                </Button>
              </div>
            </>
          )}

          {step === 'no_template' && (
            <Button size="sm" onClick={() => generate('free')}>
              {t('modeWhatsApp')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
