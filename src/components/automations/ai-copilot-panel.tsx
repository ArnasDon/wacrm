'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Send,
  Sparkles,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { GeneratedAutomation } from '@/lib/automations/dsl/schema';
import type { ValidationIssue } from '@/lib/automations/validate';

import {
  canCreateCopilotDraft,
  shouldSendCopilotMessageFromKeydown,
} from './ai-copilot-panel-state';

interface CopilotQuestion {
  kind: 'question';
  text: string;
  reasonCode: string;
  choices: string[];
}

interface CopilotDraft {
  kind: 'draft';
  automation: GeneratedAutomation;
  generation_id: string;
  verified: boolean;
  issues: ValidationIssue[];
  preview: {
    trigger: string;
    steps: string[];
  };
}

interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
}

interface ApiError {
  error?: string;
  code?: string;
}

type CopilotTurnKind = 'draft' | 'question' | null;

const RESOURCE_REASON_CODES = new Set([
  'missing_reference',
  'resource_not_found',
  'resource_ambiguous',
  'invalid_custom_field_value',
]);

export function AiCopilotPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('Automations.copilot');
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [question, setQuestion] = useState<CopilotQuestion | null>(null);
  const [draft, setDraft] = useState<CopilotDraft | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [lastTurnKind, setLastTurnKind] = useState<CopilotTurnKind>(null);
  const [progressStage, setProgressStage] = useState(0);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);

  const progressSteps = [
    t('progressInterpret'),
    t('progressResolve'),
    t('progressValidate'),
    t('progressVerify'),
  ];
  const canCreate = canCreateCopilotDraft({
    draft,
    hasPendingQuestion: question !== null,
    lastTurnKind,
  });

  function reset() {
    setInput('');
    setHistory([]);
    setQuestion(null);
    setDraft(null);
    setApiError(null);
    setLastTurnKind(null);
    setProgressStage(0);
  }

  async function handleSend(messageOverride?: string) {
    const message = (messageOverride ?? input).trim();
    if (!message || sending || creating) return;

    const priorHistory = history;
    const userEntry: ChatEntry = { role: 'user', text: message };
    const progressTimers = [
      setTimeout(() => setProgressStage(2), 300),
      setTimeout(() => setProgressStage(3), 650),
      setTimeout(() => setProgressStage(4), 1000),
    ];

    setSending(true);
    setProgressStage(1);
    setApiError(null);
    setInput('');
    setHistory([...priorHistory, userEntry]);

    try {
      const res = await fetch('/api/automations/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          history: priorHistory,
          currentDraft: draft?.automation ?? null,
          locale,
        }),
      });
      const data = (await res.json()) as
        CopilotQuestion | CopilotDraft | ApiError;

      if (!res.ok) {
        const error = data as ApiError;
        setApiError(error);
        setLastTurnKind(null);
        setProgressStage(0);
        toast.error(error.error ?? t('genericError'));
        return;
      }

      if ('kind' in data && data.kind === 'question') {
        const nextQuestion: CopilotQuestion = {
          ...data,
          choices: Array.isArray(data.choices)
            ? data.choices.filter(
                (choice): choice is string => typeof choice === 'string'
              )
            : [],
        };
        setQuestion(nextQuestion);
        setLastTurnKind('question');
        setHistory([
          ...priorHistory,
          userEntry,
          { role: 'assistant', text: nextQuestion.text },
        ]);
        setProgressStage(2);
        return;
      }

      if ('kind' in data && data.kind === 'draft') {
        setDraft(data);
        setQuestion(null);
        setLastTurnKind('draft');
        setHistory([
          ...priorHistory,
          userEntry,
          {
            role: 'assistant',
            text: t('draftSummary', { name: data.automation.name }),
          },
        ]);
        setProgressStage(5);
        return;
      }

      setApiError({ error: t('genericError') });
      setLastTurnKind(null);
      setProgressStage(0);
      toast.error(t('genericError'));
    } catch {
      setApiError({ error: t('networkError') });
      setLastTurnKind(null);
      setProgressStage(0);
      toast.error(t('networkError'));
    } finally {
      progressTimers.forEach(clearTimeout);
      setSending(false);
    }
  }

  async function handleCreateDraft() {
    const currentDraft = draft;
    if (!currentDraft) {
      return;
    }
    if (
      !canCreateCopilotDraft({
        draft: currentDraft,
        hasPendingQuestion: question !== null,
        lastTurnKind,
      })
    ) {
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...currentDraft.automation,
          source: 'ai_copilot',
          generation_id: currentDraft.generation_id,
          is_active: false,
        }),
      });
      const data = (await res.json()) as {
        automation?: { id?: string };
        error?: string;
      };
      if (!res.ok || !data.automation?.id) {
        toast.error(data.error ?? t('createError'));
        return;
      }

      toast.success(t('draftCreated'));
      onOpenChange(false);
      reset();
      router.push(`/automations/${data.automation.id}/edit`);
    } catch {
      toast.error(t('createError'));
    } finally {
      setCreating(false);
    }
  }

  const showResourceSettings =
    question !== null && RESOURCE_REASON_CODES.has(question.reasonCode);
  const showAiSettings =
    apiError?.code === 'model_incompatible' ||
    apiError?.code === 'ai_not_configured';

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) reset();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-primary h-4 w-4" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <ol
          aria-label={t('progressLabel')}
          aria-live="polite"
          className="border-border bg-muted/40 grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-4"
        >
          {progressSteps.map((label, index) => {
            const step = index + 1;
            const complete = progressStage > step;
            const active = progressStage === step;

            return (
              <li
                key={label}
                aria-current={active ? 'step' : undefined}
                className={`flex items-center gap-1.5 text-xs ${
                  complete || active
                    ? 'text-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                {complete ? (
                  <CheckCircle2 className="text-primary h-3.5 w-3.5" />
                ) : active ? (
                  <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Circle className="h-3.5 w-3.5" />
                )}
                <span>{label}</span>
              </li>
            );
          })}
        </ol>

        <div
          aria-label={t('historyLabel')}
          className="max-h-52 space-y-2 overflow-y-auto"
        >
          {history.map((entry, index) => (
            <p
              key={`${entry.role}-${index}`}
              className={
                entry.role === 'user'
                  ? 'text-foreground break-words text-sm'
                  : 'text-muted-foreground break-words text-sm'
              }
            >
              <span className="font-medium">
                {entry.role === 'user' ? t('you') : t('assistant')}:{' '}
              </span>
              {entry.text}
            </p>
          ))}
        </div>

        {apiError && (
          <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-sm">
            <p>{apiError.error ?? t('genericError')}</p>
            {showAiSettings && (
              <Link
                href="/settings?tab=ai-agent"
                className="mt-1 inline-block font-medium underline underline-offset-4"
              >
                {t('openAiSettings')}
              </Link>
            )}
          </div>
        )}

        {question && (
          <div className="border-border space-y-3 rounded-md border p-3">
            <p className="text-foreground break-words text-sm">
              {question.text}
            </p>
            {question.choices.length > 0 && (
              <div
                role="group"
                aria-label={t('choicesLabel')}
                className="flex flex-wrap gap-2"
              >
                {question.choices.map((choice) => (
                  <Button
                    key={choice}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="max-w-full whitespace-normal text-left"
                    disabled={sending || creating}
                    onClick={() => void handleSend(choice)}
                  >
                    {choice}
                  </Button>
                ))}
              </div>
            )}
            {showResourceSettings && (
              <Link
                href="/settings"
                className="text-primary inline-block text-xs font-medium underline underline-offset-4"
              >
                {t('configureResources')}
              </Link>
            )}
          </div>
        )}

        {draft && (
          <div className="border-border space-y-3 rounded-md border p-3">
            <div>
              <p className="text-foreground text-sm font-semibold">
                {draft.automation.name}
              </p>
              {draft.automation.description && (
                <p className="text-muted-foreground text-xs">
                  {draft.automation.description}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t('previewTitle')}
              </p>
              <p className="text-foreground text-sm">
                <span className="font-medium">{t('triggerLabel')}:</span>{' '}
                {draft.preview.trigger}
              </p>
              <ol
                aria-label={t('previewStepsLabel')}
                className="text-muted-foreground space-y-1 text-sm"
              >
                {draft.preview.steps.map((step, index) => (
                  <li key={`${index}-${step}`} className="break-words">
                    {index + 1}. {step}
                  </li>
                ))}
              </ol>
            </div>

            {draft.verified && draft.issues.length === 0 ? (
              <div className="bg-primary/10 text-primary flex items-center gap-2 rounded-md p-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>{t('verified')}</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="space-y-1">
                  <p>
                    {draft.issues.length > 0
                      ? t('needsReview', { count: draft.issues.length })
                      : t('verificationRequired')}
                  </p>
                  {draft.issues.map((issue, index) => (
                    <p key={`${issue.path}-${index}`} className="break-words">
                      {issue.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t('placeholder')}
            aria-label={t('messageLabel')}
            autoFocus={open}
            maxLength={2000}
            className="bg-muted text-foreground"
            onKeyDown={(event) => {
              if (
                shouldSendCopilotMessageFromKeydown({
                  key: event.key,
                  isComposing: event.nativeEvent.isComposing,
                  sending,
                  creating,
                  value: input,
                })
              ) {
                void handleSend();
              }
            }}
          />
          <Button
            type="button"
            aria-label={t('send')}
            onClick={() => void handleSend()}
            disabled={sending || creating || !input.trim()}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        {draft && (
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setProgressStage(0);
              }}
              disabled={creating || sending}
            >
              {t('tryAgain')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreateDraft()}
              disabled={creating || sending || !canCreate}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('createDraft')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
