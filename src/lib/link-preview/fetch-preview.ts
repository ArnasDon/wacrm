// Server-side link-preview fetcher for /api/link-preview. Reuses the
// project's existing SSRF guard (`isDeliverableUrl`, built for outbound
// webhook delivery) rather than a second private-IP allowlist — see
// src/lib/webhooks/ssrf.ts for what it does and its documented residual
// risk (no DNS-rebinding protection; fetch doesn't expose pinning the
// resolved IP into the socket, same accepted limitation as that module).

import { isDeliverableUrl } from "@/lib/webhooks/ssrf";
import { parseHtmlMetadata } from "./parse-og";
import { getCached, setCached, dedupe } from "./cache";
import type { LinkPreviewData } from "./types";

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024; // never read past this looking for </head>
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (compatible; WACRMLinkPreview/1.0; +https://crmronaldomeira.com)";

export type LinkPreviewResult =
  | { status: "ok"; data: LinkPreviewData }
  | { status: "error"; error: string };

/** Validates scheme, strips the fragment (never sent to the server and
 *  never affects OG metadata) and lowercases the host, so equivalent URLs
 *  share one cache entry. Returns null for anything that isn't http(s). */
function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchOnce(url: string): Promise<Response> {
  return fetch(url, {
    method: "GET",
    // Manual redirects: each hop is re-validated through isDeliverableUrl
    // below before being followed, so a public URL can't 3xx-bounce to an
    // internal address and bypass the SSRF check (same pattern as
    // src/lib/webhooks/deliver.ts).
    redirect: "manual",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

/** Reads the response body only up to MAX_BYTES, stopping early the
 *  moment `</head>` shows up (where OG tags live in practice) — the
 *  "don't download a large file just to find metadata" guard. Cancels the
 *  underlying stream instead of draining a possibly-huge remainder. */
async function readBoundedHtml(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (bytes >= MAX_BYTES || /<\/head>/i.test(html)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return html;
}

async function safeFetchHtml(
  startUrl: string,
): Promise<{ html: string; finalUrl: string } | null> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isDeliverableUrl(current))) return null;

    let res: Response;
    try {
      res = await fetchOnce(current);
    } catch {
      return null; // network error / timeout
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        return null;
      }
      const normalizedNext = normalizeUrl(next);
      if (!normalizedNext) return null;
      current = normalizedNext;
      continue; // re-validated (isDeliverableUrl) at the top of the next hop
    }

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) return null;

    const html = await readBoundedHtml(res);
    return { html, finalUrl: current };
  }

  return null; // exhausted MAX_REDIRECTS
}

/** Resolves a link preview for `rawUrl`: cache → in-flight dedup → fetch.
 *  Only returns `status: "error"` for a malformed/non-http(s) input — any
 *  failure past that point (blocked by SSRF guard, timeout, non-HTML,
 *  no usable metadata) resolves as `status: "ok"` with `unavailable: true`,
 *  which is itself cached (with the shorter negative TTL) so a bad URL
 *  can't trigger a fresh fetch on every render. */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewResult> {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) return { status: "error", error: "Invalid URL" };

  const cached = getCached(normalized);
  if (cached) return { status: "ok", data: cached };

  return dedupe(normalized, async () => {
    // Re-check the cache once we actually hold the dedup slot — a
    // concurrent request may have just populated it while this one was
    // waiting to be scheduled.
    const cachedNow = getCached(normalized);
    if (cachedNow) return { status: "ok", data: cachedNow };

    const hostname = new URL(normalized).hostname;
    const fetched = await safeFetchHtml(normalized);
    if (!fetched) {
      const data: LinkPreviewData = { url: normalized, hostname, unavailable: true };
      setCached(normalized, data, false);
      return { status: "ok", data };
    }

    const meta = parseHtmlMetadata(fetched.html, fetched.finalUrl);
    const hasUsableMetadata = !!(meta.title || meta.description || meta.image);
    if (!hasUsableMetadata) {
      const data: LinkPreviewData = { url: normalized, hostname, unavailable: true };
      setCached(normalized, data, false);
      return { status: "ok", data };
    }

    const data: LinkPreviewData = {
      url: normalized,
      hostname,
      title: meta.title ?? hostname,
      description: meta.description,
      image: meta.image,
      siteName: meta.siteName ?? hostname,
    };
    setCached(normalized, data, true);
    return { status: "ok", data };
  });
}
