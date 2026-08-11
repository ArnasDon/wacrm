"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { FileText, ImageOff, Link as LinkIcon, Video as VideoIcon, Image as ImageIcon } from "lucide-react";
import type { Message } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MediaLightbox } from "./media-lightbox";
import { useResolvedMediaSrc } from "@/lib/inbox/use-resolved-media-src";

// Same as `message-composer.tsx`'s PICKER_ACCEPT / the `chat-media`
// bucket allowlist (migration 023) — the infrastructure never stores
// anything but these `content_type`s (see `types/index.ts`'s
// `ContentType` union), so the gallery only ever has these four tabs.
// No 'sticker' tab, no speculative future types.
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

interface LinkHit {
  key: string;
  url: string;
  createdAt: string;
  senderLabel: string;
}

interface MediaGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full message list for the OPEN conversation — the same array the
   *  thread itself renders from (`MessageThread`'s `messages` prop), so
   *  this is a derived view of history already in memory, not a new
   *  fetch/table. */
  messages: Message[];
  /** Defensive re-filter, belt-and-suspenders against a caller ever
   *  passing an unscoped array — every tab below only ever shows media
   *  for this conversation. */
  conversationId: string;
  /** Agent-sent bubbles are labelled with this instead of the contact's
   *  name — same rule `MessageThread.authorLabelFor` already uses. */
  contactDisplayName: string;
}

function isAgentMessage(m: Message) {
  return m.sender_type === "agent" || m.sender_type === "bot";
}

export function MediaGallery({
  open,
  onOpenChange,
  messages,
  conversationId,
  contactDisplayName,
}: MediaGalleryProps) {
  const t = useTranslations("Inbox.mediaGallery");
  const [lightboxSrc, setLightboxSrc] = useState<{ url: string; alt: string } | null>(null);

  const scoped = useMemo(
    () => messages.filter((m) => m.conversation_id === conversationId),
    [messages, conversationId],
  );

  // Newest first — a media grid reads better that way (WhatsApp's own
  // media tab does the same), unlike the thread itself which is
  // oldest-first for natural reading order.
  const images = useMemo(
    () =>
      scoped
        .filter((m) => m.content_type === "image" && m.media_url)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [scoped],
  );
  const videos = useMemo(
    () =>
      scoped
        .filter((m) => m.content_type === "video" && m.media_url)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [scoped],
  );
  const documents = useMemo(
    () =>
      scoped
        .filter((m) => m.content_type === "document" && m.media_url)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [scoped],
  );
  const links = useMemo<LinkHit[]>(() => {
    const hits: LinkHit[] = [];
    for (const m of scoped) {
      if (!m.content_text) continue;
      const matches = m.content_text.match(URL_PATTERN);
      if (!matches) continue;
      for (const url of matches) {
        hits.push({
          key: `${m.id}-${hits.length}`,
          url,
          createdAt: m.created_at,
          senderLabel: isAgentMessage(m) ? t("you") : contactDisplayName,
        });
      }
    }
    return hits.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [scoped, contactDisplayName, t]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] w-full max-w-lg flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="images" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="w-full">
              <TabsTrigger value="images">
                {t("images")} {images.length > 0 && `(${images.length})`}
              </TabsTrigger>
              <TabsTrigger value="videos">
                {t("videos")} {videos.length > 0 && `(${videos.length})`}
              </TabsTrigger>
              <TabsTrigger value="documents">
                {t("documents")} {documents.length > 0 && `(${documents.length})`}
              </TabsTrigger>
              <TabsTrigger value="links">
                {t("links")} {links.length > 0 && `(${links.length})`}
              </TabsTrigger>
            </TabsList>

            <ScrollArea className="mt-2 min-h-0 flex-1">
              <TabsContent value="images" className="p-1">
                {images.length === 0 ? (
                  <EmptyState icon={ImageIcon} label={t("noImages")} />
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {images.map((m) => (
                      <GalleryImageThumb
                        key={m.id}
                        url={m.media_url!}
                        onOpen={(src) =>
                          setLightboxSrc({ url: src, alt: m.content_text || t("images") })
                        }
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="videos" className="space-y-2 p-1">
                {videos.length === 0 ? (
                  <EmptyState icon={VideoIcon} label={t("noVideos")} />
                ) : (
                  videos.map((m) => (
                    <div key={m.id} className="space-y-1">
                      <video src={m.media_url} controls className="w-full rounded-lg" />
                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(m.created_at), "MMM d, yyyy HH:mm")}
                      </p>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="documents" className="space-y-1.5 p-1">
                {documents.length === 0 ? (
                  <EmptyState icon={FileText} label={t("noDocuments")} />
                ) : (
                  documents.map((m) => (
                    <a
                      key={m.id}
                      href={m.media_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 hover:bg-muted"
                    >
                      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">
                          {m.content_text || t("documents")}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {isAgentMessage(m) ? t("you") : contactDisplayName} ·{" "}
                          {format(new Date(m.created_at), "MMM d, yyyy HH:mm")}
                        </p>
                      </div>
                    </a>
                  ))
                )}
              </TabsContent>

              <TabsContent value="links" className="space-y-1.5 p-1">
                {links.length === 0 ? (
                  <EmptyState icon={LinkIcon} label={t("noLinks")} />
                ) : (
                  links.map((hit) => (
                    <a
                      key={hit.key}
                      href={hit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 rounded-lg bg-muted/50 px-3 py-2 hover:bg-muted"
                    >
                      <LinkIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-primary">{hit.url}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {hit.senderLabel} ·{" "}
                          {format(new Date(hit.createdAt), "MMM d, yyyy HH:mm")}
                        </p>
                      </div>
                    </a>
                  ))
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </DialogContent>
      </Dialog>

      <MediaLightbox
        open={!!lightboxSrc}
        onOpenChange={(next) => {
          if (!next) setLightboxSrc(null);
        }}
        src={lightboxSrc?.url ?? ""}
        alt={lightboxSrc?.alt ?? ""}
      />
    </>
  );
}

function EmptyState({
  icon: Icon,
  label,
}: {
  icon: typeof ImageIcon;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/** Thumbnail tile — resolves the same way `MediaImage` (message bubble)
 *  does, so a proxy-backed inbound image never double-fetches once the
 *  bubble has already loaded it... except here it's the gallery opening
 *  first, so this is its own fetch; there's no cross-component cache to
 *  share without introducing one, which isn't worth it for a modal
 *  opened on demand. */
function GalleryImageThumb({
  url,
  onOpen,
}: {
  url: string;
  onOpen: (src: string) => void;
}) {
  const { src, loading, error } = useResolvedMediaSrc(url);

  if (error) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-md bg-muted">
        <ImageOff className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  if (loading || !src) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-md bg-muted">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(src)}
      className="aspect-square cursor-zoom-in overflow-hidden rounded-md bg-muted"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="h-full w-full object-cover" />
    </button>
  );
}
