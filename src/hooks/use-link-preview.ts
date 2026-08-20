"use client";

import { useCallback, useEffect, useState } from "react";

export interface LinkPreviewData {
  url: string;
  hostname: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export type LinkPreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: LinkPreviewData }
  | { status: "unavailable" }
  | { status: "error" };

// Client-side cache + in-flight dedup, module-scoped so every
// <LinkPreviewCard> mounted for the same URL — the same link pasted into
// several messages, or one re-rendering — shares a single request instead
// of firing one per component instance. Session-lived only, on purpose:
// the API route's own cache (src/lib/link-preview/cache.ts) is the
// durable, TTL'd source of truth across page loads/users; this layer just
// avoids redundant round-trips to *our own* endpoint within the open tab.
const resultCache = new Map<string, LinkPreviewState>();
const inFlight = new Map<string, Promise<LinkPreviewState>>();

async function resolvePreview(url: string): Promise<LinkPreviewState> {
  const cached = resultCache.get(url);
  if (cached) return cached;

  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = (async (): Promise<LinkPreviewState> => {
    try {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
      if (!res.ok) return { status: "error" };
      const data = await res.json();
      if (data?.unavailable) return { status: "unavailable" };
      if (!data?.title && !data?.description && !data?.image) {
        return { status: "unavailable" };
      }
      return { status: "success", data };
    } catch {
      return { status: "error" };
    }
  })();

  inFlight.set(url, promise);
  try {
    const result = await promise;
    resultCache.set(url, result);
    return result;
  } finally {
    inFlight.delete(url);
  }
}

/** Resolves (with cache + request dedup) the link preview for `url`, or
 *  stays `idle` when `url` is null — e.g. a message with no linkable URL.
 *  Never re-fetches an already-settled `unavailable`/`error` result for
 *  the same URL across remounts (mount just reads it back from
 *  `resultCache`), so a bad link can't loop new requests on every render. */
export function useLinkPreview(url: string | null): LinkPreviewState {
  const [state, setState] = useState<LinkPreviewState>(() =>
    url ? (resultCache.get(url) ?? { status: "idle" }) : { status: "idle" },
  );

  const load = useCallback(async (targetUrl: string | null, cancelledRef: { current: boolean }) => {
    if (!targetUrl) {
      setState({ status: "idle" });
      return;
    }
    const cached = resultCache.get(targetUrl);
    if (cached) {
      setState(cached);
      return;
    }
    setState({ status: "loading" });
    const result = await resolvePreview(targetUrl);
    if (!cancelledRef.current) setState(result);
  }, []);

  // load()'s setState calls run inside an async callback, not
  // synchronously in this effect body — same pattern/exception as
  // contact-sidebar.tsx's fetchContactData().
  useEffect(() => {
    const cancelledRef = { current: false };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(url, cancelledRef);
    return () => {
      cancelledRef.current = true;
    };
  }, [url, load]);

  return state;
}
