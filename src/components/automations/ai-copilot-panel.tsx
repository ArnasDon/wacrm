'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
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

export function AiCopilotPanel({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('Automations.copilot');
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [question, setQuestion] = useState<CopilotQuestion | null>(null);
  const [draft, setDraft] = useState<CopilotDraft | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);
  const [lastTurnKind, setLastTurnKind] = useState<CopilotTurnKind>(null);
  const [progressStage, setProgressStage] = useState(0);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const progressSteps = [
    t('progressInterpret'),
    t('progressResolve'),
    t('progressValidate'),
    t('progressVerify'),
  ];
  const canCreateDraft = canCreateCopilotDraft({
    draft,
    hasPendingQuestion: question !== null,
    lastTurnKind,
  });

  useEffect(() => {
    if (!canCreate) setOpen(false);
  }, [canCreate]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [apiError, draft, history, open, progressStage, question, sending]);

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
    if (!message || sending || creating || !canCreate) return;

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
    if (!canCreate || !currentDraft) {
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
      setOpen(false);
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
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && !canCreate) return;
        setOpen(nextOpen);
      }}
    >
      <div
        className="fixed z-20"
        style={{
          right: 'calc(0.75rem + env(safe-area-inset-right))',
          bottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
        }}
      >
        <PopoverTrigger
          render={
            <GatedButton
              canAct={canCreate}
              gateReason="create automations"
              type="button"
              size="icon-lg"
              aria-label={t('openLabel')}
              aria-controls="ai-automation-copilot"
              className="size-14 rounded-full p-0 shadow-[0_18px_44px_rgb(21_159_153_/_0.34)] transition-transform duration-200 hover:-translate-y-1 motion-reduce:transform-none motion-reduce:transition-none"
            />
          }
        >
          <Sparkles className="size-5" aria-hidden />
        </PopoverTrigger>
      </div>

      <PopoverContent
        id="ai-automation-copilot"
        side="top"
        align="end"
        sideOffset={12}
        positionMethod="fixed"
        collisionPadding={12}
        collisionAvoidance={{
          side: 'shift',
          align: 'shift',
          fallbackAxisSide: 'none',
        }}
        positionerClassName="z-20"
        initialFocus={(openType) =>
          openType === 'touch' ? true : inputRef.current
        }
        className="decizyon-card border-border bg-card text-card-foreground z-20 w-[calc(100vw-1.5rem)] max-w-[400px] gap-0 overflow-hidden rounded-2xl border p-0 ring-0 duration-200 ease-out motion-reduce:animate-none motion-reduce:transition-none"
        style={{
          height:
            'min(640px, calc(100dvh - 7rem - env(safe-area-inset-bottom)))',
        }}
      >
        <header className="border-border bg-card/95 flex shrink-0 items-start gap-3 border-b px-4 py-3 backdrop-blur">
          <span
            className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl"
            aria-hidden
          >
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <PopoverTitle className="text-foreground text-sm font-semibold">
              {t('title')}
            </PopoverTitle>
            <PopoverDescription className="text-muted-foreground mt-0.5 text-xs leading-4">
              {t('description')}
            </PopoverDescription>
          </div>
          <PopoverClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('closeLabel')}
                className="-mr-1 shrink-0"
              />
            }
          >
            <X className="size-4" aria-hidden />
          </PopoverClose>
        </header>

        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={sending}
          aria-label={t('conversationLabel')}
          className="bg-muted/20 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
        >
          <ChatBubble
            role="assistant"
            roleLabel={t('assistant')}
            text={t('greeting')}
          />

          {progressStage > 0 && (
            <ol
              aria-label={t('progressLabel')}
              className="border-border bg-card grid grid-cols-2 gap-2 rounded-xl border p-2"
            >
              {progressSteps.map((label, index) => {
                const step = index + 1;
                const complete = progressStage > step;
                const active = progressStage === step;

                return (
                  <li
                    key={label}
                    aria-current={active ? 'step' : undefined}
                    className={`flex items-center gap-1.5 text-[11px] ${
                      complete || active
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {complete ? (
                      <CheckCircle2 className="text-primary size-3.5 shrink-0" />
                    ) : active ? (
                      <Loader2 className="text-primary size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Circle className="size-3.5 shrink-0" />
                    )}
                    <span>{label}</span>
                  </li>
                );
              })}
            </ol>
          )}

          {history.map((entry, index) => (
            <ChatBubble
              key={`${entry.role}-${index}`}
              role={entry.role}
              roleLabel={entry.role === 'user' ? t('you') : t('assistant')}
              text={entry.text}
            />
          ))}

          {apiError && (
            <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-xl border p-3 text-sm">
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
            <div className="border-border bg-card space-y-3 rounded-2xl rounded-bl-md border p-3">
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
                      className="h-auto max-w-full text-left whitespace-normal"
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
            <article className="border-primary/25 bg-card space-y-3 rounded-2xl rounded-bl-md border p-3 shadow-sm">
              <div>
                <p className="text-foreground text-sm font-semibold break-words">
                  {draft.automation.name}
                </p>
                {draft.automation.description && (
                  <p className="text-muted-foreground mt-1 text-xs leading-4 break-words">
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
                  className="text-muted-foreground space-y-1 text-xs leading-4"
                >
                  {draft.preview.steps.map((step, index) => (
                    <li key={`${index}-${step}`} className="break-words">
                      {index + 1}. {step}
                    </li>
                  ))}
                </ol>
              </div>

              {draft.verified && draft.issues.length === 0 ? (
                <div className="bg-primary/10 text-primary flex items-center gap-2 rounded-lg p-2 text-xs">
                  <CheckCircle2 className="size-3.5 shrink-0" />
                  <span>{t('verified')}</span>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
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

              <div className="border-border flex flex-wrap justify-end gap-2 border-t pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft(null);
                    setProgressStage(0);
                    inputRef.current?.focus();
                  }}
                  disabled={creating || sending}
                >
                  {t('tryAgain')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleCreateDraft()}
                  disabled={creating || sending || !canCreateDraft}
                >
                  {creating ? (
                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  ) : null}
                  {t('createDraft')}
                </Button>
              </div>
            </article>
          )}

          {sending ? <TypingIndicator label={t('typing')} /> : null}
          <div ref={endRef} aria-hidden />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSend();
          }}
          className="border-border bg-card flex shrink-0 items-center gap-2 border-t px-3 py-3"
        >
          <label htmlFor="ai-automation-message" className="sr-only">
            {t('inputLabel')}
          </label>
          <Input
            ref={inputRef}
            id="ai-automation-message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t('placeholder')}
            aria-label={t('messageLabel')}
            maxLength={2000}
            disabled={creating}
            className="bg-muted/60 text-foreground h-10"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing) {
                event.preventDefault();
                return;
              }
              if (
                shouldSendCopilotMessageFromKeydown({
                  key: event.key,
                  isComposing: event.nativeEvent.isComposing,
                  sending,
                  creating,
                  value: input,
                })
              ) {
                event.preventDefault();
                void handleSend();
              }
            }}
          />
          <Button
            type="submit"
            size="icon-lg"
            aria-label={t('sendLabel')}
            disabled={sending || creating || !input.trim() || !canCreate}
            className="size-10 shrink-0"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function ChatBubble({
  role,
  roleLabel,
  text,
}: {
  role: ChatEntry['role'];
  roleLabel: string;
  text: string;
}) {
  return (
    <div
      className={role === 'user' ? 'flex justify-end' : 'flex justify-start'}
    >
      <p
        className={
          role === 'user'
            ? 'bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm leading-5 break-words'
            : 'border-border bg-card text-foreground max-w-[85%] rounded-2xl rounded-bl-md border px-3 py-2 text-sm leading-5 break-words'
        }
      >
        <span className="sr-only">{roleLabel}: </span>
        {text}
      </p>
    </div>
  );
}

function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div
        role="status"
        className="border-border bg-card flex items-center gap-1 rounded-2xl rounded-bl-md border px-3 py-2.5"
      >
        <span className="sr-only">{label}</span>
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            aria-hidden
            className="bg-muted-foreground size-1.5 animate-bounce rounded-full motion-reduce:animate-none"
            style={{ animationDelay: `${dot * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
