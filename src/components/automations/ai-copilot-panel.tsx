'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Send, Sparkles, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { triggerMeta } from '@/lib/automations/trigger-meta';
import type { GeneratedAutomation } from '@/lib/ai/automation-generate';
import type { ValidationIssue } from '@/lib/automations/validate';

interface DraftPreview {
  automation: GeneratedAutomation;
  issues: ValidationIssue[];
}

interface ChatEntry {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  draft?: DraftPreview;
}

function summarizeDraft(automation: GeneratedAutomation) {
  return `Draft: "${automation.name}" — trigger: ${automation.trigger_type}, ${automation.steps.length} step(s)`;
}

export function AiCopilotPanel({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const t = useTranslations('Automations.copilot');
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nextEntryId = useRef(0);

  useEffect(() => {
    if (!canCreate) setOpen(false);
  }, [canCreate]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [history, open, sending]);

  function reset() {
    setInput('');
    setHistory([]);
    nextEntryId.current = 0;
  }

  function addEntry(entry: Omit<ChatEntry, 'id'>) {
    const id = nextEntryId.current;
    nextEntryId.current += 1;
    setHistory((current) => [...current, { ...entry, id }]);
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending || creating || !canCreate) return;

    const requestHistory = history.map(({ role, text }) => ({ role, text }));
    setSending(true);
    setInput('');
    addEntry({ role: 'user', text: message });

    try {
      const res = await fetch('/api/automations/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, history: requestHistory }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('genericError'));
        return;
      }

      if (data.kind === 'question') {
        addEntry({ role: 'assistant', text: data.text });
        return;
      }

      const automation: GeneratedAutomation = data.automation;
      addEntry({
        role: 'assistant',
        text: summarizeDraft(automation),
        draft: {
          automation,
          issues: Array.isArray(data.issues) ? data.issues : [],
        },
      });
    } catch {
      toast.error(t('networkError'));
    } finally {
      setSending(false);
    }
  }

  async function handleCreateDraft(draft: DraftPreview) {
    if (!canCreate || creating) return;
    setCreating(true);

    try {
      const res = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft.automation, is_active: false }),
      });
      const data = await res.json();
      if (!res.ok) {
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

  function handleTryAgain(entryId: number) {
    setHistory((current) =>
      current.map((entry) =>
        entry.id === entryId ? { ...entry, draft: undefined } : entry
      )
    );
    inputRef.current?.focus();
  }

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
            'min(600px, calc(100dvh - 7rem - env(safe-area-inset-bottom)))',
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

          {history.map((entry) =>
            entry.draft ? (
              <DraftCard
                key={entry.id}
                entryId={entry.id}
                draft={entry.draft}
                assistantLabel={t('assistant')}
                creating={creating}
                sending={sending}
                onTryAgain={handleTryAgain}
                onCreate={handleCreateDraft}
                t={t}
              />
            ) : (
              <ChatBubble
                key={entry.id}
                role={entry.role}
                roleLabel={entry.role === 'user' ? t('you') : t('assistant')}
                text={entry.text}
              />
            )
          )}

          {sending ? <TypingIndicator label={t('typing')} /> : null}
          <div ref={endRef} aria-hidden />
        </div>

        <form
          onSubmit={handleSend}
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
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing) {
                event.preventDefault();
              }
            }}
            placeholder={t('placeholder')}
            maxLength={2000}
            disabled={creating}
            className="bg-muted/60 text-foreground h-10"
          />
          <Button
            type="submit"
            size="icon-lg"
            aria-label={t('sendLabel')}
            disabled={sending || creating || !input.trim() || !canCreate}
            className="size-10 shrink-0"
          >
            {sending ? (
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Send className="size-4" aria-hidden />
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

function DraftCard({
  entryId,
  draft,
  assistantLabel,
  creating,
  sending,
  onTryAgain,
  onCreate,
  t,
}: {
  entryId: number;
  draft: DraftPreview;
  assistantLabel: string;
  creating: boolean;
  sending: boolean;
  onTryAgain: (entryId: number) => void;
  onCreate: (draft: DraftPreview) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex justify-start">
      <article className="border-primary/25 bg-card w-[92%] space-y-3 rounded-2xl rounded-bl-md border p-3 shadow-sm">
        <span className="sr-only">{assistantLabel}: </span>
        <div>
          <p className="text-foreground text-sm font-semibold break-words">
            {draft.automation.name}
          </p>
          {draft.automation.description ? (
            <p className="text-muted-foreground mt-1 text-xs leading-4 break-words">
              {draft.automation.description}
            </p>
          ) : null}
        </div>

        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium">
            {t('triggerLabel')}:
          </span>{' '}
          {triggerMeta(draft.automation.trigger_type).label}
        </p>

        <ol className="text-muted-foreground space-y-1 text-xs leading-4">
          {draft.automation.steps.map((step, index) => (
            <li key={`${step.step_type}-${index}`} className="break-words">
              {index + 1}. {step.step_type}
              {step.parent_index !== null
                ? ` (${t('branch')}: ${step.branch})`
                : ''}
            </li>
          ))}
        </ol>

        {draft.issues.length > 0 ? (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-2 text-xs leading-4 text-amber-500">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{t('needsReview', { count: draft.issues.length })}</span>
          </div>
        ) : null}

        <div className="border-border flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onTryAgain(entryId)}
            disabled={creating || sending}
          >
            {t('tryAgain')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onCreate(draft)}
            disabled={creating || sending}
          >
            {creating ? (
              <Loader2
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : null}
            {t('createDraft')}
          </Button>
        </div>
      </article>
    </div>
  );
}
