import type { Message } from "@/types";

/**
 * The set of media in a thread that the lightbox can page through, built
 * from the messages the thread already holds (no extra fetch).
 *
 * Only images and videos qualify: an audio bubble has nothing to look at,
 * and a document is handed to the OS rather than rendered. Rows with no
 * `media_url` are skipped — that's either media Meta refused to verify
 * (`verifyAndBuildUrl` returns null in the webhook) or media whose bytes
 * Meta has since expired, and both render as "unavailable" in the bubble.
 */

export type MediaGalleryKind = "image" | "video";

export interface MediaGalleryItem {
  /** `messages.id` — the lightbox's identity for "which one is open". */
  messageId: string;
  url: string;
  kind: MediaGalleryKind;
  /** Caption, when the sender attached one. */
  caption?: string;
  createdAt: string;
  /** Drives the "You" vs contact-name label in the viewer header. */
  fromCustomer: boolean;
  /** The row itself, so a download can derive its filename. */
  message: Message;
}

function galleryKind(message: Message): MediaGalleryKind | null {
  if (message.content_type === "image") return "image";
  if (message.content_type === "video") return "video";
  return null;
}

/**
 * Viewable media in thread order. Order matters — it's what ← / → walk,
 * and the thread hands messages over already sorted by `created_at`.
 */
export function collectMediaGallery(messages: Message[]): MediaGalleryItem[] {
  const items: MediaGalleryItem[] = [];
  for (const message of messages) {
    const kind = galleryKind(message);
    if (!kind || !message.media_url) continue;
    items.push({
      messageId: message.id,
      url: message.media_url,
      kind,
      caption: message.content_text || undefined,
      createdAt: message.created_at,
      fromCustomer: message.sender_type === "customer",
      message,
    });
  }
  return items;
}

/** Index of a message in the gallery, or -1 when it isn't in it. */
export function galleryIndexOf(
  items: MediaGalleryItem[],
  messageId: string | null,
): number {
  if (!messageId) return -1;
  return items.findIndex((item) => item.messageId === messageId);
}
