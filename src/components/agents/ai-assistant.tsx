'use client';

import { readResponseJson } from '@/lib/http/response-json';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  RotateCcw,
  Send,
  Loader2,
  UserCircle2,
  ShieldCheck,
  X,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

interface PendingAction {
  action: string;
  input: Record<string, unknown>;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  pendingAction?: PendingAction;
}

const ACTION_LABELS: Record<string, string> = {
  close_conversation: 'Close conversation',
  mark_deal_won: 'Mark deal as won',
  move_deal: 'Move deal to another stage',
  set_lead_temperature: 'Change lead temperature',
  create_quote: 'Create a quote',
  schedule_appointment: 'Schedule a real appointment',
  create_task: 'Create a task / reminder',
  create_automation_rule: 'Create a new automation rule (draft)',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** Skip noisy/large fields in the confirmation card's detail list —
 *  `steps`/`trigger_config`/`items` are shown as counts instead. */
function detailEntries(input: Record<string, unknown>): [string, string][] {
  return Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]): [string, string] => {
      if (Array.isArray(v))
        return [k, `${v.length} item${v.length === 1 ? '' : 's'}`];
      if (typeof v === 'object') return [k, JSON.stringify(v)];
      return [k, String(v)];
    });
}

export function AiAssistant() {
  const { user } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmingIndex, setConfirmingIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error('No agent configured yet — finish Setup first.');
        } else if (data.code === 'unsupported_provider') {
          toast.error(data.error ?? 'This assistant needs an Anthropic key.');
        } else {
          toast.error(data.error ?? "Couldn't reach the assistant.");
        }
        setTurns(turns);
        setInput(text);
        return;
      }
      setTurns([
        ...next,
        {
          role: 'assistant',
          content: typeof data.reply === 'string' ? data.reply : '',
          pendingAction: data.pendingAction ?? undefined,
        },
      ]);
    } catch {
      toast.error("Couldn't reach the assistant.");
      setTurns(turns);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const discardAction = (index: number) => {
    setTurns((prev) =>
      prev.map((t, i) => (i === index ? { ...t, pendingAction: undefined } : t))
    );
  };

  const confirmAction = async (index: number) => {
    const turn = turns[index];
    if (!turn?.pendingAction || confirmingIndex !== null) return;
    setConfirmingIndex(index);
    try {
      const { action, input: actionInput } = turn.pendingAction;
      if (action === 'create_automation_rule') {
        const res = await fetch('/api/automations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: actionInput.name,
            description: actionInput.description,
            trigger_type: actionInput.trigger_type,
            trigger_config: actionInput.trigger_config,
            steps: actionInput.steps,
            is_active: false,
            source: 'ai_assistant',
          }),
        });
        const data = await readResponseJson(res).catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? 'Could not create the rule.');
          return;
        }
        toast.success(
          'Rule saved as a draft in Automations — review and activate it there.'
        );
      } else if (action === 'create_task') {
        const hours = Number(actionInput.dueInHours);
        const dueAt =
          Number.isFinite(hours) && hours > 0
            ? new Date(Date.now() + hours * 3_600_000).toISOString()
            : null;
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: actionInput.title,
            notes: actionInput.notes,
            due_at: dueAt,
            assigned_to: user?.id ?? null,
            contact_id:
              typeof actionInput.linkContactId === 'string'
                ? actionInput.linkContactId
                : null,
          }),
        });
        const data = await readResponseJson(res).catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? 'Could not create the task.');
          return;
        }
        toast.success(
          dueAt
            ? 'Task created — you\'ll get a reminder when it\'s due.'
            : 'Task created.'
        );
      } else {
        const payload = { action, ...actionInput };
        const first = await fetch('/api/ai/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const firstData = await readResponseJson(first).catch(() => ({}));
        if (first.status !== 409 || !firstData.confirmation) {
          toast.error(firstData.error ?? 'Could not confirm this action.');
          return;
        }
        const second = await fetch('/api/ai/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            confirmation: firstData.confirmation,
          }),
        });
        const secondData = await readResponseJson(second).catch(() => ({}));
        if (!second.ok) {
          toast.error(secondData.error ?? 'Could not complete this action.');
          return;
        }
        toast.success('Done.');
      }
      discardAction(index);
    } catch {
      toast.error('Something went wrong confirming this.');
    } finally {
      setConfirmingIndex(null);
    }
  };

  return (
    <div className="border-border bg-card flex h-[65vh] min-h-[460px] flex-col rounded-xl border">
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-primary h-4 w-4" />
          <span className="text-foreground text-sm font-medium">Assistant</span>
          <span className="text-muted-foreground text-xs">
            — owner-only, can propose real changes to this account
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTurns([])}
          disabled={turns.length === 0 || sending}
          className="text-muted-foreground"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center text-center text-sm">
            <Bot className="text-muted-foreground/60 mb-2 h-8 w-8" />
            <p>
              Ask about your sales, get a suggestion, or ask it to do something.
            </p>
            <p className="mt-1 text-xs">
              e.g. &quot;How many deals did we win/lose this month?&quot; or
              &quot;Move Juan&apos;s deal to Won&quot;. Any change is proposed
              first — nothing runs until you confirm it below.
            </p>
          </div>
        )}

        {turns.map((t, i) => (
          <div
            key={i}
            className={cn(
              'flex gap-2',
              t.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            {t.role === 'assistant' && (
              <Bot className="text-primary mt-1 h-5 w-5 shrink-0" />
            )}
            <div className="flex max-w-[85%] flex-col gap-2">
              {t.content && (
                <div
                  className={cn(
                    'rounded-2xl px-3.5 py-2 text-sm',
                    t.role === 'user'
                      ? 'bg-primary text-primary-foreground self-end rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm'
                  )}
                >
                  <p className="whitespace-pre-wrap">{t.content}</p>
                </div>
              )}

              {t.role === 'assistant' && t.pendingAction && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    Proposed: {actionLabel(t.pendingAction.action)}
                  </p>
                  <dl className="text-muted-foreground mt-1.5 space-y-0.5 text-xs">
                    {detailEntries(t.pendingAction.input).map(([k, v]) => (
                      <div key={k} className="flex gap-1.5">
                        <dt className="shrink-0 font-medium">{k}:</dt>
                        <dd className="truncate">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-2.5 flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => confirmAction(i)}
                      disabled={confirmingIndex !== null}
                    >
                      {confirmingIndex === i ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="mr-1 h-3 w-3" />
                      )}
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground h-7 px-2.5 text-xs"
                      onClick={() => discardAction(i)}
                      disabled={confirmingIndex !== null}
                    >
                      <X className="mr-1 h-3 w-3" /> Discard
                    </Button>
                  </div>
                </div>
              )}
            </div>
            {t.role === 'user' && (
              <UserCircle2 className="text-muted-foreground mt-1 h-5 w-5 shrink-0" />
            )}
          </div>
        ))}

        {sending && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Bot className="text-primary h-5 w-5" />
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      <div className="border-border flex items-end gap-2 border-t p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your business, or ask it to do something…"
          rows={1}
          className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm outline-none"
        />
        <Button
          size="sm"
          onClick={send}
          disabled={!input.trim() || sending}
          className="h-9 w-9 shrink-0 p-0"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
