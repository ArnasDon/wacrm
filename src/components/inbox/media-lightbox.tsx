"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  ImageOff,
  Loader2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMediaBlobUrl } from "@/hooks/use-media-blob-url";
import { downloadMediaMessage } from "@/lib/media/download";
import { galleryIndexOf, type MediaGalleryItem } from "@/lib/media/gallery";

/**
 * Full-size viewer for the images and videos in the open conversation
 * (issue #373). One instance lives at the thread level rather than one per
 * bubble, which is what lets ← / → page through the whole thread's media
 * instead of just re-opening the one that was clicked.
 *
 * `activeId` is a `messages.id`, not an index: the thread's message list is
 * live (realtime inserts, optimistic bubbles being swapped for their real
 * rows), so an index would silently start pointing at a different photo.
 */

type Translator = ReturnType<typeof useTranslations>;

/** Leaves room for the caption and the header inside a 100vh dialog. */
const MEDIA_MAX_HEIGHT = "max-h-[75vh]";

interface MediaLightboxProps {
  items: MediaGalleryItem[];
  /** `messages.id` of the item on screen; null closes the viewer. */
  activeId: string | null;
  onActiveIdChange: (id: string | null) => void;
  /** Display name used for customer-sent media. */
  contactLabel: string;
}

export function MediaLightbox({
  items,
  activeId,
  onActiveIdChange,
  contactLabel,
}: MediaLightboxProps) {
  const t = useTranslations("Inbox.mediaViewer");

  const index = galleryIndexOf(items, activeId);
  const item = index >= 0 ? items[index] : null;

  // Zoom is tracked by id, not a boolean, so moving to the next photo shows
  // it fit-to-screen without an effect resetting the flag after the fact.
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const zoomed = activeId !== null && zoomedId === activeId;
  const [downloading, setDownloading] = useState(false);

  const toggleZoom = useCallback(() => {
    setZoomedId((current) => (current === activeId ? null : activeId));
  }, [activeId]);

  const goTo = useCallback(
    (next: number) => {
      const target = items[next];
      if (target) onActiveIdChange(target.messageId);
    },
    [items, onActiveIdChange],
  );

  // Arrow keys page through the gallery. Bound on window so it works
  // whichever control inside has focus, and in the CAPTURE phase because
  // base-ui's popup stops arrow-key propagation for its own focus
  // management — a bubble-phase listener here never fires. Esc is left
  // alone; the dialog already closes on it.
  useEffect(() => {
    if (index < 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(index + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [index, goTo]);

  const handleDownload = useCallback(async () => {
    if (!item || downloading) return;
    setDownloading(true);
    try {
      await downloadMediaMessage(item.message);
    } catch {
      toast.error(t("downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }, [downloading, item, t]);

  if (!item) return null;

  const authorLabel = item.fromCustomer ? contactLabel : t("you");
  const timestamp = format(new Date(item.createdAt), "MMM d, yyyy HH:mm");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onActiveIdChange(null);
      }}
    >
      <DialogContent className="flex w-auto max-w-[95vw] flex-col gap-3 p-3 sm:max-w-[min(95vw,72rem)]">
        {/* pr-9 keeps the toolbar clear of the dialog's own close button. */}
        <DialogHeader className="flex-row items-start gap-3 pr-9">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate">{authorLabel}</DialogTitle>
            <DialogDescription className="truncate text-xs">
              {timestamp}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {items.length > 1 && (
              <span className="mr-1 text-xs tabular-nums text-muted-foreground">
                {t("counter", { index: index + 1, total: items.length })}
              </span>
            )}
            {item.kind === "image" && (
              <ToolbarButton
                icon={zoomed ? ZoomOut : ZoomIn}
                label={zoomed ? t("zoomOut") : t("zoomIn")}
                onClick={toggleZoom}
              />
            )}
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("openOriginal")}
              title={t("openOriginal")}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <ToolbarButton
              icon={Download}
              label={t("download")}
              onClick={handleDownload}
              busy={downloading}
            />
          </div>
        </DialogHeader>

        <div className="relative flex items-center justify-center">
          {item.kind === "image" ? (
            <LightboxImage
              item={item}
              zoomed={zoomed}
              onToggleZoom={toggleZoom}
              t={t}
            />
          ) : (
            <video
              // Plain URL, never a blob — the player should stream.
              src={item.url}
              controls
              preload="metadata"
              className={cn(MEDIA_MAX_HEIGHT, "max-w-full rounded-lg")}
            />
          )}

          {items.length > 1 && (
            <>
              <NavButton
                side="left"
                icon={ChevronLeft}
                label={t("previous")}
                disabled={index <= 0}
                onClick={() => goTo(index - 1)}
              />
              <NavButton
                side="right"
                icon={ChevronRight}
                label={t("next")}
                disabled={index >= items.length - 1}
                onClick={() => goTo(index + 1)}
              />
            </>
          )}
        </div>

        {item.caption && (
          <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm">
            {item.caption}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LightboxImage({
  item,
  zoomed,
  onToggleZoom,
  t,
}: {
  item: MediaGalleryItem;
  zoomed: boolean;
  onToggleZoom: () => void;
  t: Translator;
}) {
  // Hits the blob cache when the thumbnail already pulled these bytes, so
  // opening the viewer is instant rather than a second trip through Meta.
  const { src, status } = useMediaBlobUrl(item.url);
  const [broken, setBroken] = useState(false);

  if (status === "error" || broken) {
    return (
      <div className="flex h-64 w-full min-w-64 flex-col items-center justify-center gap-2 rounded-lg bg-muted text-sm text-muted-foreground">
        <ImageOff className="h-8 w-8" />
        <span>{t("failed")}</span>
      </div>
    );
  }

  if (status !== "ready" || !src) {
    return (
      <div className="flex h-64 w-full min-w-64 items-center justify-center rounded-lg bg-muted">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    // When zoomed the image renders at natural size and this box scrolls;
    // otherwise it's capped to the viewport. Centring is `mx-auto` on the
    // image rather than `justify-center` here on purpose: a flex-centred
    // child that overflows its scroll container spills equally both ways and
    // the left half becomes unreachable (scrollWidth stops at the right
    // overflow). Auto margins on a block child collapse to 0 once it's
    // wider, so the whole image stays scrollable.
    <div className={cn("w-full", MEDIA_MAX_HEIGHT, zoomed && "overflow-auto")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={item.caption || t("imageAlt")}
        onClick={onToggleZoom}
        onError={() => setBroken(true)}
        className={cn(
          "mx-auto block rounded-lg",
          zoomed
            ? "max-w-none cursor-zoom-out"
            : cn(MEDIA_MAX_HEIGHT, "max-w-full cursor-zoom-in object-contain"),
        )}
      />
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  busy = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
    </button>
  );
}

function NavButton({
  side,
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-background/85 text-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-background disabled:pointer-events-none disabled:opacity-0",
        side === "left" ? "left-1" : "right-1",
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
