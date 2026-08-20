"use client";

import type { ReactNode } from "react";
import { Link2 } from "lucide-react";
import type { LinkPreviewData } from "@/hooks/use-link-preview";
import { cn } from "@/lib/utils";

interface LinkPreviewCardProps {
  data: LinkPreviewData;
  isAgent: boolean;
  /** Present only when this card IS the entire message — a link-only text
   *  (no other words), matching WhatsApp's own layout: no separate
   *  "https://…" line, just the card, with the timestamp/status inside its
   *  own footer instead of the bubble's normal row. The caller (MessageBubble)
   *  also drops the bubble's usual padding down to the same 2px frame used
   *  for a caption-less photo — this card renders edge-to-edge into that
   *  frame. Omitted when other text follows the card in the bubble; then it
   *  renders as a self-bordered inset card and the caption's own timestamp
   *  row (rendered by the caller afterward) handles the time. */
  overlay?: { time: string; status: ReactNode };
}

/** Big WhatsApp-style link-preview card: full-width image, then a footer
 *  (title/description/domain) tinted to match the bubble it's in. Pure
 *  presentation — MessageBubble owns fetching the data (via
 *  `useLinkPreview`) so it can decide, from the same success/failure state,
 *  whether to also render the message's own text. */
export function LinkPreviewCard({ data, isAgent, overlay }: LinkPreviewCardProps) {
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "block overflow-hidden transition-colors",
        overlay
          ? "relative" // edge-to-edge — the caller's 2px frame already provides rounding/border
          : cn(
              "mb-1 rounded-lg border",
              isAgent
                ? "border-primary-foreground/20 bg-primary-foreground/10 hover:bg-primary-foreground/15"
                : "border-border bg-background/60 hover:bg-background",
            ),
      )}
    >
      {data.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.image}
          alt=""
          className={cn("aspect-video w-full object-cover", !overlay && "rounded-t-lg")}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div
        className={cn(
          "relative space-y-1 px-3 pt-2.5",
          overlay ? "pb-6" : "pb-2.5", // pb-6 reserves room for the absolute timestamp below
          isAgent ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {data.title && (
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{data.title}</p>
        )}
        {data.description && (
          <p
            className={cn(
              "line-clamp-2 text-xs",
              isAgent ? "text-primary-foreground/80" : "text-muted-foreground",
            )}
          >
            {data.description}
          </p>
        )}
        <div
          className={cn(
            "flex items-center gap-1 text-[11px]",
            isAgent ? "text-primary-foreground/60" : "text-muted-foreground",
          )}
        >
          <Link2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{data.siteName || data.hostname}</span>
        </div>
        {overlay && (
          <span className="absolute bottom-2 right-3 flex items-center gap-1 text-[10px]">
            {overlay.time}
            {overlay.status}
          </span>
        )}
      </div>
    </a>
  );
}
