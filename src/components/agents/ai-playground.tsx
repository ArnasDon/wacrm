'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Bot, RotateCcw, Send, Loader2, UserCircle2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** assistant-only: the agent signalled a human handoff on this turn. */
  handoff?: boolean;
  /** assistant-only: how many KB chunks were retrieved for this turn. */
  knowledgeCount?: number;
  /** assistant-only: catalog tools the agent actually called this turn
   *  (search_catalog/get_product/…) — surfaced so a tester can see
   *  whether it consulted the catalog or answered from the KB/memory. */
  toolCalls?: { name: string }[];
  /** assistant-only: product photo(s) get_product_media resolved. Never
   *  actually sent — Playground never touches WhatsApp. */
  media?: { url: string; alt?: string }[];
}

function isSpanish(text: string): boolean {
  return /[¿¡áéíóúñü]|hola|gracias|por\s+favor|b[a-u]squeda/i.test(text)
}

function loadingLabel(input: string): string {
  if (isSpanish(input)) return 'Pensando…'
  return 'Thinking…'
}

// Playground reliability audit (Oct 2026) — the server has no hard
// ceiling tighter than Vercel's own function timeout (300s, confirmed
// against the live deployment — see route.ts's own comment), and the
// browser's fetch() has NO built-in timeout at all: left unbounded, a
// slow provider/tool chain left `sending` stuck true indefinitely, with
// no way for the admin to escape it (Reset was disabled while sending,
// and a second message could never be submitted either). This bounds
// the wait to something far shorter than the server's own ceiling, so
// the UI always recovers with a clear error instead of spinning
// forever. Generous on purpose — even with the new 6-tool-call budget,
// a real multi-turn catalog investigation can legitimately take 30-60s.
const PLAYGROUND_FETCH_TIMEOUT_MS = 120_000

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export function AiPlayground({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Structured cross-turn catalog state the server returns and expects
  // back verbatim — see src/lib/ai/catalog/context.ts. This is what
  // lets "¿y el morado?" resolve two turns after "¿tienen el A07?"
  // without the model having to re-derive the product from its own
  // prior prose. Opaque to this component; never rendered.
  const catalogContextRef = useRef<unknown>(null);

  const loadingTextRef = useRef('Thinking…');
  // The in-flight request's own controller — lets Reset (or a future
  // message) actually cancel a stuck/slow request instead of just
  // abandoning it while it keeps running server-side.
  const abortRef = useRef<AbortController | null>(null);
  // Playground reliability audit (Oct 2026), follow-up fix — identifies
  // the CURRENT "generation" of conversation state. Aborting the fetch
  // does nothing once it has already resolved (e.g. Reset lands while
  // `res.json()` is still pending, or while a THEN-superseded request's
  // own promise chain is simply running) — `signal.aborted`/comparing
  // against `abortRef.current` can't catch that, since there is no
  // network-level signal to check once the response already arrived.
  // Every state-mutating point below instead re-checks this generation
  // id immediately before writing, and bails silently if a newer
  // generation (a later send(), or Reset) has superseded it — so a
  // stale request can never resurrect a cleared transcript, overwrite a
  // NEWER request's result, or flip `sending` back closed/open for
  // generation it doesn't belong to.
  const generationRef = useRef(0);

  const lastUserContent = turns.reduceRight<string>((_, t) => t.role === 'user' ? t.content : _, '');

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    loadingTextRef.current = loadingLabel(text);

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setSending(true);

    const myGeneration = ++generationRef.current;
    const isCurrent = () => generationRef.current === myGeneration;

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), PLAYGROUND_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch('/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The server ignores anything on each turn besides role+content
          // — catalog_context is the one exception, carried separately.
          messages: next.map((t) => ({ role: t.role, content: t.content })),
          catalog_context: catalogContextRef.current,
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      // Superseded (Reset, or — after Reset — a brand-new send()) while
      // the response was in flight. Never apply it, in EITHER branch
      // below: it could otherwise resurrect a cleared transcript or
      // stomp a newer, still-in-progress generation's own turns.
      if (!isCurrent()) return;
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
      // Persist for the NEXT request regardless of whether this turn
      // used the catalog — carries forward what earlier turns resolved.
      catalogContextRef.current = data.catalog_context ?? catalogContextRef.current;
      setTurns([
        ...next,
        {
          role: 'assistant',
          content:
            typeof data.reply === 'string' && data.reply.trim()
              ? data.reply
              : '',
          handoff: Boolean(data.handoff),
          knowledgeCount:
            typeof data.knowledge_count === 'number' ? data.knowledge_count : 0,
          toolCalls: Array.isArray(data.tool_calls) ? data.tool_calls : undefined,
          media: Array.isArray(data.media) ? data.media : undefined,
        },
      ]);
    } catch (err) {
      if (!isCurrent()) return
      // A user-initiated Reset also aborts the in-flight request — that
      // is not a failure worth a toast, `turns`/`input` were already
      // cleared by Reset itself, so there is nothing to roll back here.
      // (The generation check above already covers this too — kept for
      // the narrower case where the SAME generation's own abort fires,
      // e.g. a future caller aborting without bumping the generation.)
      if (isAbortError(err) && abortRef.current !== controller) {
        return;
      }
      toast.error(
        isAbortError(err)
          ? "The agent took too long to respond. You can try again."
          : "Couldn't reach the agent.",
      );
      setTurns(turns);
      setInput(text);
    } finally {
      clearTimeout(timeoutId);
      if (abortRef.current === controller) abortRef.current = null;
      // Never close (or re-open) `sending` on behalf of a generation
      // that isn't the current one — a superseded request's finally
      // must not flip the flag for whatever NEWER request (or Reset) is
      // now active.
      if (isCurrent()) setSending(false);
    }
  };

  const reset = () => {
    // Bump the generation FIRST — this alone is what invalidates any
    // in-flight request's result, independent of whether aborting the
    // network request itself has any effect by this point.
    generationRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setTurns([]);
    catalogContextRef.current = null;
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-[60vh] min-h-[420px] flex-col rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Playground</span>
          <span className="text-xs text-muted-foreground">
            — test replies as if you were a customer
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={turns.length === 0 && !sending}
          className="text-muted-foreground"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
        </Button>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Bot className="mb-2 h-8 w-8 text-muted-foreground/60" />
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
                Not set up yet? Go to Setup <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        {turns.map((t, i) => (
          <div
            key={i}
            className={cn(
              'flex gap-2',
              t.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            {t.role === 'assistant' && (
              <Bot className="mt-1 h-5 w-5 shrink-0 text-primary" />
            )}
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                t.role === 'user'
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'rounded-bl-sm bg-muted text-foreground',
              )}
            >
              {t.content && <p className="whitespace-pre-wrap">{t.content}</p>}
              {/* Playground reliability audit (Oct 2026) — an empty,
                  non-handoff reply used to render as a silently blank
                  bubble, indistinguishable from the message never having
                  arrived at all. Always show SOMETHING for a completed
                  turn. */}
              {t.role === 'assistant' && !t.content && !t.handoff && (
                <p className="italic text-muted-foreground">
                  {isSpanish(lastUserContent) ? '(sin texto de respuesta)' : '(no reply text)'}
                </p>
              )}
              {t.role === 'assistant' && t.handoff && (
                <p
                  className={cn(
                    'flex items-center gap-1 text-xs text-amber-500',
                    t.content && 'mt-1.5 border-t border-border/50 pt-1.5',
                  )}
                >
                  <UserCircle2 className="h-3.5 w-3.5" />
                  {isSpanish(lastUserContent) ? 'Derivaría a un humano aquí' : 'Would hand off to a human here'}
                </p>
              )}
              {t.role === 'assistant' && !t.handoff && t.knowledgeCount !== undefined && (
                <p className={cn('mt-1.5 flex items-center gap-1 text-xs', t.content && 'border-t border-border/50 pt-1.5', t.knowledgeCount > 0 ? 'text-muted-foreground' : 'text-destructive')}>
                  {t.knowledgeCount > 0
                    ? `📄 Found ${t.knowledgeCount} product(s)`
                    : '📄 No matching products found'}
                </p>
              )}
              {t.role === 'assistant' && t.toolCalls && t.toolCalls.length > 0 && (
                <p className={cn('mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground', t.content && 'border-t border-border/50 pt-1.5')}>
                  🔧 {t.toolCalls.map((c) => c.name).join(', ')}
                </p>
              )}
              {t.role === 'assistant' && t.media && t.media.length > 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  📷 {t.media.length} photo(s) resolved — not sent (Playground never messages WhatsApp)
                </p>
              )}
            </div>
            {t.role === 'user' && (
              <UserCircle2 className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bot className="h-5 w-5 text-primary" />
            <Loader2 className="h-4 w-4 animate-spin" /> {loadingTextRef.current}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-border p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a customer message…"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
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
