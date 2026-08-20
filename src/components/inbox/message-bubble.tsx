"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { MediaLightbox } from "./media-lightbox";
import { LinkPreviewCard } from "./link-preview-card";
import { useResolvedMediaSrc } from "@/lib/inbox/use-resolved-media-src";
import { extractUrls, linkifyText } from "@/lib/inbox/linkify";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { useTranslations } from "next-intl";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
}

function StatusIcon({
  status,
  overlay,
}: {
  status: Message["status"];
  /** True when drawn over a photo (see MediaImage's `overlay`) instead of
   *  the bubble's own background — swaps the neutral tick color for white
   *  so it stays legible against arbitrary photo content. The read/failed
   *  colors stay as-is either way; those are meaningful status colors, not
   *  just theme-matching. */
  overlay?: boolean;
}) {
  const neutral = overlay ? "h-3 w-3 text-white" : "h-3 w-3 text-muted-foreground";
  switch (status) {
    case "sending":
      return <Clock className={neutral} />;
    case "sent":
      return <Check className={neutral} />;
    case "delivered":
      return <CheckCheck className={neutral} />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MediaUnavailable({ label, t }: { label: string, t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{t("unavailable", { label })}</span>
    </div>
  );
}

function MediaImage({
  url,
  alt,
  t,
  overlay,
}: {
  url: string;
  alt: string;
  t: ReturnType<typeof useTranslations>;
  /** WhatsApp-iOS-style timestamp/status drawn over the photo itself
   *  (bottom-right, on a bottom-edge gradient) instead of the bubble's
   *  normal row below it. Only passed for a caption-less image message —
   *  see MessageBubble's `isFramedPhoto`. */
  overlay?: { time: string; status: ReactNode };
}) {
  const { src, loading, error, setError } = useResolvedMediaSrc(url);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Unique per instance — an SVG filter id must be unique in the document,
  // and a thread can render many photo bubbles at once.
  const shadeFilterId = useId();

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      {/* Reuses the already-loaded `src` (blob: URL for proxy-backed
          inbound media, or the direct URL for outbound) — opening the
          lightbox never re-fetches the image. `relative` only when
          overlaying — it's the "immediate wrapper of the image" the
          timestamp/gradient position against. */}
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        aria-label={t("photo")}
        className={cn("block cursor-zoom-in", overlay && "relative")}
      >
        <img
          src={src ?? ""}
          alt={alt}
          className="max-h-64 max-w-60 rounded-lg object-cover"
          onError={() => setError(true)}
        />
        {overlay && (
          <>
            {/* Contrast shading — one blurred ellipse (SVG + feGaussianBlur),
                not a CSS gradient: a gradient box has a hard edge wherever
                its own bounding box ends, which showed up as a visible
                rotated-rectangle line across the photo. A blurred shape has
                no such boundary — it fades to nothing on its own. Tilted
                ~40° and anchored at the image's own corner; scales with the
                photo via the 0–100 viewBox instead of fixed pixels. Never
                intercepts clicks (the button above it already handles
                opening the lightbox). */}
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <defs>
                <filter id={shadeFilterId} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="8" />
                </filter>
              </defs>
              <ellipse
                cx="100"
                cy="100"
                rx="42"
                ry="18"
                fill="rgba(0,0,0,0.5)"
                filter={`url(#${shadeFilterId})`}
                transform="rotate(-40 100 100)"
              />
            </svg>
            <span className="absolute bottom-[6px] right-2 z-[2] flex items-center gap-1 text-[11px] text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
              {overlay.time}
              {overlay.status}
            </span>
          </>
        )}
      </button>
      <MediaLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        src={src ?? ""}
        alt={alt}
      />
    </>
  );
}

function MessageContent({ message, t }: { message: Message, t: ReturnType<typeof useTranslations> }) {
  switch (message.content_type) {
    case "text":
      return (
        <p className="select-text whitespace-pre-wrap break-words text-sm">
          {linkifyText(message.content_text)}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" t={t} />
          ) : (
            <MediaUnavailable label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 select-text whitespace-pre-wrap break-words text-sm">
              {linkifyText(message.content_text)}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaUnavailable label={t("video")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 select-text whitespace-pre-wrap break-words text-sm">
              {linkifyText(message.content_text)}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaUnavailable label={t("audio")} t={t} />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || t("document")} t={t} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {message.content_text || t("document")}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            {t("template")}
          </span>
          {message.content_text && (
            <p className="mt-1 select-text whitespace-pre-wrap break-words text-sm">
              {linkifyText(message.content_text)}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="select-text">
            {linkifyText(message.content_text || t("locationShared"))}
          </span>
        </div>
      );

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <p className="select-text whitespace-pre-wrap break-words text-sm">
              {linkifyText(message.content_text || t("interactiveReply"))}
            </p>
          </div>
        );
      }
      return (
        <p className="select-text whitespace-pre-wrap break-words text-sm">
          {linkifyText(message.content_text || t("interactiveReply"))}
        </p>
      );
    }

    default:
      return (
        <p className="select-text whitespace-pre-wrap break-words text-sm">
          {linkifyText(message.content_text || t("unsupported"))}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");

  // One preview per message, for the first http(s) URL in its text —
  // any others stay plain clickable links (linkifyText above). Computed
  // here (not inside MessageContent) so every content_type with a
  // content_text caption gets the same single card, from one place,
  // instead of a copy of this per switch-case.
  const previewUrl = useMemo(
    () => extractUrls(message.content_text)[0] ?? null,
    [message.content_text],
  );

  // WhatsApp-iOS-style framed photo: a caption-less image message drops
  // the bubble's usual text padding entirely (down to a 2px frame) and
  // overlays the timestamp/status on the photo itself instead of giving
  // them their own row below it. A caption (content_text) keeps the
  // existing layout — image, caption text, timestamp row — unchanged;
  // this repositioning is only for the pure-photo case the task's mockup
  // shows.
  const isFramedPhoto =
    message.content_type === "image" && !!message.media_url && !message.content_text;

  const timestamp = (
    <span
      className={cn(
        "text-[10px]",
        // Outbound bubbles sit on the primary fill, so the timestamp must
        // read against that (not the neutral foreground) — otherwise it
        // goes low-contrast in light mode. Inbound bubbles use the muted
        // surface.
        isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
      )}
    >
      {time}
    </span>
  );

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl",
          isFramedPhoto ? "overflow-hidden p-[2px]" : "px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {reply && (
          <div className={isFramedPhoto ? "px-2 pt-2" : undefined}>
            <ReplyQuote
              authorLabel={reply.authorLabel}
              preview={reply.preview}
              onPrimary={isAgent}
            />
          </div>
        )}

        {isFramedPhoto && message.media_url ? (
          <MediaImage
            url={message.media_url}
            alt="Shared image"
            t={t}
            overlay={{
              time,
              status: isAgent ? <StatusIcon status={message.status} overlay /> : null,
            }}
          />
        ) : (
          <>
            <MessageContent message={message} t={t} />
            {previewUrl && <LinkPreviewCard url={previewUrl} isAgent={isAgent} />}
            <div
              className={cn(
                "mt-1 flex items-center gap-1",
                isAgent ? "justify-end" : "justify-start",
              )}
            >
              {/* AI badge — only on replies the auto-reply bot generated
                  (always outbound, so it sits on the primary fill). Lets
                  agents tell an AI reply from their own / a Flow's at a
                  glance. */}
              {message.ai_generated && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
                  title={t("aiBadgeTitle")}
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  {t("aiBadge")}
                </span>
              )}
              {timestamp}
              {isAgent && <StatusIcon status={message.status} />}
            </div>
          </>
        )}
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
