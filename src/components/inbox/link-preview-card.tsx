"use client";

import { useLinkPreview } from "@/hooks/use-link-preview";
import { cn } from "@/lib/utils";

interface LinkPreviewCardProps {
  url: string;
  isAgent: boolean;
}

/** Single link-preview card for a message — mounted once per bubble (see
 *  MessageBubble) for the first linkable URL in its text. Renders nothing
 *  while idle/loading/unavailable/error: no skeleton, no empty card, no
 *  layout placeholder — the message (and its own clickable link, from
 *  linkify.tsx) already stands on its own without this, so there's
 *  nothing wrong to show while a preview isn't ready or doesn't exist. */
export function LinkPreviewCard({ url, isAgent }: LinkPreviewCardProps) {
  const state = useLinkPreview(url);

  if (state.status !== "success") return null;

  const { data } = state;

  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        // max-w-60 matches this file's own MediaImage/video thumbnails —
        // a compact WhatsApp-style card, not a card that stretches to
        // fill the bubble's full 75%-of-thread width.
        "mt-2 block max-w-60 overflow-hidden rounded-lg border transition-colors",
        isAgent
          ? "border-primary-foreground/20 bg-primary-foreground/10 hover:bg-primary-foreground/15"
          : "border-border bg-background/60 hover:bg-background",
      )}
    >
      {data.image && (
        // Fixed, modest height (not aspect-video) — WhatsApp's own link
        // thumbnail is a compact strip, not a wide 16:9 hero image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.image}
          alt=""
          className="h-28 w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="space-y-0.5 px-2.5 py-1.5">
        {data.title && (
          <p className="line-clamp-2 text-xs font-semibold">{data.title}</p>
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
        <p
          className={cn(
            "truncate text-[10px] uppercase tracking-wide",
            isAgent ? "text-primary-foreground/60" : "text-muted-foreground",
          )}
        >
          {data.siteName || data.hostname}
        </p>
      </div>
    </a>
  );
}
