"use client";

import { useEffect, useState } from "react";
import { isProxiedMediaUrl, loadMediaBlob } from "@/lib/media/blob-cache";

export type MediaLoadStatus = "idle" | "loading" | "ready" | "error";

interface MediaBlobUrlState {
  /** Ready-to-render URL: the original for public media, an object URL for proxied. */
  src: string | null;
  status: MediaLoadStatus;
}

/** A settled load, tagged with the URL it belongs to. */
interface ResolvedMedia {
  url: string;
  objectUrl: string | null;
  failed: boolean;
}

/**
 * Resolve a `messages.media_url` into something an `<img>` can render.
 *
 * Public `chat-media` URLs are handed straight back — the browser fetches
 * and caches them itself. Inbound `/api/whatsapp/media/*` URLs are pulled
 * through `loadMediaBlob` (credentialed, cached, de-duplicated) and turned
 * into an object URL that is revoked when the URL changes or the component
 * unmounts.
 *
 * Only use this for images. Video and audio must keep their plain URL so
 * the element streams instead of buffering up to 16 MB before it plays.
 */
export function useMediaBlobUrl(url: string | undefined): MediaBlobUrlState {
  const [resolved, setResolved] = useState<ResolvedMedia | null>(null);

  useEffect(() => {
    if (!url || !isProxiedMediaUrl(url)) return;

    let cancelled = false;
    // Held in a local rather than read back off state, because that is
    // exactly the bug this replaces: the previous implementation's cleanup
    // closed over a `src` that was still null when the effect ran, so no
    // object URL was ever revoked.
    let objectUrl: string | null = null;

    loadMediaBlob(url)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setResolved({ url, objectUrl, failed: false });
      })
      .catch(() => {
        if (cancelled) return;
        setResolved({ url, objectUrl: null, failed: true });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!url) return { src: null, status: "idle" };

  // Nothing to load for a public URL — derived here rather than pushed
  // through state so the first paint already has the image.
  if (!isProxiedMediaUrl(url)) return { src: url, status: "ready" };

  // A result for a *previous* URL is stale; the new URL's load is already
  // in flight, so report loading rather than flashing the old image.
  if (resolved?.url === url) {
    return resolved.failed
      ? { src: null, status: "error" }
      : { src: resolved.objectUrl, status: "ready" };
  }

  return { src: null, status: "loading" };
}
