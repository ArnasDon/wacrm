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
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** assistant-only: the agent signalled a human handoff on this turn. */
  handoff?: boolean;
}

export function AiPlayground({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
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
      const res = await fetch('/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send only role+content — the server ignores anything else.
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error('No agent configured yet — finish Setup first.');
        } else {
          toast.error(data.error ?? "Couldn't get a reply.");
        }
        // Roll the unsent user turn back so the transcript stays clean.
        setTurns(turns);
        setInput(text);
        return;
      }
      setTurns([
        ...next,
        {
          role: 'assistant',
          content:
            typeof data.reply === 'string' && data.reply.trim()
              ? data.reply
              : '',
          handoff: Boolean(data.handoff),
        },
      ]);
    } catch {
      toast.error("Couldn't reach the agent.");
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

  return (
    <div className="border-border bg-card flex h-[60vh] min-h-[420px] flex-col rounded-xl border">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="text-primary h-4 w-4" />
          <span className="text-foreground text-sm font-medium">
            Playground
          </span>
          <span className="text-muted-foreground text-xs">
            — test replies as if you were a customer
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

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center text-center text-sm">
            <Bot className="text-muted-foreground/60 mb-2 h-8 w-8" />
            <p>Send a message to see how your agent would reply.</p>
            <p className="mt-1 text-xs">
              It uses your knowledge base and behaves exactly like the
              auto-reply bot — including handoff.
            </p>
            {onGoToSetup && (
              <Button
                variant="link"
                size="sm"
                onClick={onGoToSetup}
                className="mt-1 h-auto p-0 text-xs"
              >
                Not set up yet? Go to Setup{' '}
                <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
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
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                t.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : 'bg-muted text-foreground rounded-bl-sm'
              )}
            >
              {t.content && <p className="whitespace-pre-wrap">{t.content}</p>}
              {t.role === 'assistant' && t.handoff && (
                <p
                  className={cn(
                    'flex items-center gap-1 text-xs text-amber-500',
                    t.content && 'border-border/50 mt-1.5 border-t pt-1.5'
                  )}
                >
                  <UserCircle2 className="h-3.5 w-3.5" />
                  Would hand off to a human here
                </p>
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

      {/* Composer */}
      <div className="border-border flex items-end gap-2 border-t p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a customer message…"
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
