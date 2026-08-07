"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  Hand,
  Undo2,
  Loader2,
  AlertTriangle,
  Send,
  WandSparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";

// ------------------------------------------------------------
// Account AI status is the same for every conversation, so cache it per
// account and reuse it across thread switches instead of hitting
// /api/ai/config every time the agent opens a chat.
// ------------------------------------------------------------
interface AiAccountStatus {
  autoReplyOn: boolean;
}
const statusCache = new Map<string, AiAccountStatus>();

async function fetchAiAccountStatus(accountId: string): Promise<AiAccountStatus> {
  const cached = statusCache.get(accountId);
  if (cached) return cached;
  try {
    const res = await fetch("/api/ai/config", { cache: "no-store" });
    if (!res.ok) return { autoReplyOn: false };
    const j = await res.json();
    const status = {
      autoReplyOn: !!(j?.configured && j?.is_active && j?.auto_reply_enabled),
    };
    statusCache.set(accountId, status);
    return status;
  } catch {
    return { autoReplyOn: false };
  }
}

interface AiThreadBannerProps {
  conversationId: string;
  /** `conversations.ai_autoreply_disabled` — bot paused on this thread. */
  disabled: boolean;
  /** `conversations.ai_handoff_summary` — internal handoff reason + summary. */
  handoffSummary?: string | null;
  /** Current assignee; when a human owns the thread the bot won't run. */
  assignedAgentId?: string | null;
  /** The acting agent — "Take over" assigns the thread to them. */
  currentUserId?: string | null;
  onChange?: (patch: {
    ai_autoreply_disabled: boolean;
    assigned_agent_id?: string | null;
  }) => void;
}

/**
 * Inbox AI control + human copilot.
 *
 * Auto mode:
 *   - AI active → "AI is replying automatically" + Take over.
 *
 * Human/handoff mode:
 *   - surfaces the internal handoff summary as "Requires intervention";
 *   - lets the human give a short internal instruction to the same AI;
 *   - AI rewrites it into a customer-ready reply;
 *   - nothing is sent until the human explicitly confirms Send.
 */
export function AiThreadBanner({
  conversationId,
  disabled,
  handoffSummary,
  assignedAgentId,
  currentUserId,
  onChange,
}: AiThreadBannerProps) {
  const t = useTranslations("Inbox.aiBanner");
  const { accountId } = useAuth();
  const [autoReplyOn, setAutoReplyOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(disabled);

  // Human copilot state. Reset when switching threads so an instruction or
  // draft for one customer can never leak into another conversation.
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => setPaused(disabled), [conversationId, disabled]);
  useEffect(() => {
    setCopilotOpen(false);
    setInstruction("");
    setDraft("");
  }, [conversationId]);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    fetchAiAccountStatus(accountId).then((s) => alive && setAutoReplyOn(s.autoReplyOn));
    return () => {
      alive = false;
    };
  }, [accountId]);

  const toggle = useCallback(
    async (nextPaused: boolean) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paused: nextPaused, assign_to_me: nextPaused }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          toast.error(j?.error ?? t("updateError"));
          return;
        }
        setPaused(nextPaused);
        onChange?.({
          ai_autoreply_disabled: nextPaused,
          ...(nextPaused
            ? currentUserId
              ? { assigned_agent_id: currentUserId }
              : {}
            : { assigned_agent_id: null }),
        });
        toast.success(nextPaused ? t("tookOver") : t("resumed"));
      } catch {
        toast.error(t("networkError"));
      } finally {
        setBusy(false);
      }
    },
    [conversationId, currentUserId, onChange, t],
  );

  const generateOperatorReply = useCallback(async () => {
    const trimmed = instruction.trim();
    if (!trimmed || generating) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/operator-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          instruction: trimmed,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error ?? "Não foi possível gerar a resposta.");
        return;
      }
      const nextDraft = typeof payload?.draft === "string" ? payload.draft.trim() : "";
      if (!nextDraft) {
        toast.error("A IA não devolveu uma resposta.");
        return;
      }
      setDraft(nextDraft);
    } catch {
      toast.error("Não foi possível contactar o assistente de IA.");
    } finally {
      setGenerating(false);
    }
  }, [conversationId, generating, instruction]);

  const sendOperatorReply = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          message_type: "text",
          content_text: text,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error ?? "Não foi possível enviar a resposta.");
        return;
      }
      toast.success("Resposta enviada.");
      setInstruction("");
      setDraft("");
      setCopilotOpen(false);
    } catch {
      toast.error("Não foi possível enviar a resposta.");
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, sending]);

  // No account AI configuration → no AI controls or copilot.
  if (!autoReplyOn) return null;

  const humanMode = paused || Boolean(assignedAgentId);

  if (humanMode) {
    return (
      <div className="border-b border-border bg-card">
        <div
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 text-xs sm:px-4",
            handoffSummary ? "bg-amber-500/10" : "bg-muted/40",
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
            {handoffSummary ? (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            ) : (
              <Hand className="h-4 w-4 text-muted-foreground" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">
              {handoffSummary ? "Requer intervenção" : "Atendimento humano"}
            </p>
            {handoffSummary ? (
              <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">
                {handoffSummary}
              </p>
            ) : (
              <p className="mt-0.5 text-muted-foreground">
                A IA automática está em pausa nesta conversa.
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <BannerButton
              onClick={() => setCopilotOpen((open) => !open)}
              busy={false}
              icon={WandSparkles}
            >
              Assistir com IA
            </BannerButton>
            {paused && (
              <BannerButton onClick={() => toggle(false)} busy={busy} icon={Undo2}>
                {t("resume")}
              </BannerButton>
            )}
          </div>
        </div>

        {copilotOpen && (
          <div className="border-t border-border bg-muted/20 px-3 py-3 sm:px-4">
            <div className="mx-auto max-w-3xl space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-foreground">Copiloto de resposta</p>
                  <p className="text-[11px] text-muted-foreground">
                    Dê a instrução em linguagem simples. A IA reformula; reveja antes de enviar.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCopilotOpen(false)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Fechar copiloto"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex gap-2">
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder='Ex.: "Diga-lhe que essa cor acabou, mas temos preto e azul."'
                  rows={2}
                  maxLength={2000}
                  className="min-h-16 flex-1 resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                />
                <button
                  type="button"
                  onClick={() => void generateOperatorReply()}
                  disabled={!instruction.trim() || generating}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 self-end rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {generating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Gerar
                </button>
              </div>

              {draft && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                      Resposta proposta
                    </p>
                    <span className="text-[10px] text-muted-foreground">Revise antes de enviar</span>
                  </div>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDraft("")}
                      disabled={sending}
                      className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      Descartar
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendOperatorReply()}
                      disabled={!draft.trim() || sending}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {sending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      Enviar ao cliente
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // AI active and no human owns the thread.
  return (
    <Banner tone="primary">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
        <span className="truncate font-medium text-foreground">
          {t("activeText")}
        </span>
      </div>
      <BannerButton onClick={() => toggle(true)} busy={busy} icon={Hand}>
        {t("takeOver")}
      </BannerButton>
    </Banner>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "primary" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b px-3 py-2 text-xs sm:px-4",
        tone === "primary"
          ? "border-primary/20 bg-primary/5"
          : "border-border bg-muted/40",
      )}
    >
      {children}
    </div>
  );
}

function BannerButton({
  onClick,
  busy,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  icon: typeof Hand;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {children}
    </button>
  );
}
