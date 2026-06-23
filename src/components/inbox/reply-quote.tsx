"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";

interface ReplyQuoteProps {
  /** Sender label of the quoted message: "You" for our own messages,
   *  contact name for customer-sent messages. Caller resolves this — the
   *  quote component doesn't see the parent Message. */
  authorLabel: string;
  /** Compact text preview. Falls back to a placeholder for media types. */
  preview: string;
  /** Present → renders the composer-chip variant with an X button. Absent →
   *  renders the embedded-in-bubble variant. */
  onDismiss?: () => void;
}

export function ReplyQuote({
  authorLabel,
  preview,
  onDismiss,
}: ReplyQuoteProps) {
  const isChip = !!onDismiss;
  return (
    <div
      className={cn(
        "flex items-start gap-2 border-l-2 border-primary px-2 py-1",
        isChip
          ? "rounded-md bg-slate-800/80"
          : "mb-1.5 rounded-md bg-black/20",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-primary">
          {authorLabel}
        </div>
        <div className="truncate text-xs text-slate-200/80">{preview}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cancelar resposta"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-700 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Build the one-line preview text shown inside a reply quote. */
export function buildReplyPreview(message: Message): string {
  if (message.content_text) return message.content_text;
  switch (message.content_type) {
    case "image":
      return "[Imagem]";
    case "video":
      return "[Vídeo]";
    case "audio":
      return "[Áudio]";
    case "document":
      return "[Documento]";
    case "location":
      return "[Localização]";
    case "template":
      return "[Modelo]";
    default:
      return "[Mensagem]";
  }
}
