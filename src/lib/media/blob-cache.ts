/**
 * Shared loader for chat-media bytes.
 *
 * A `messages.media_url` is one of two very different things:
 *
 *   1. INBOUND — `/api/whatsapp/media/<mediaId>`, our own auth-gated proxy
 *      (`src/app/api/whatsapp/media/[mediaId]/route.ts`). Meta only hands
 *      the bytes to a request carrying the account's access token, so the
 *      browser can't reach them on its own, and `next.config.ts` puts
 *      `Cache-Control: no-store` on every `/api/*` response, so nothing
 *      caches them at the HTTP layer either.
 *
 *   2. OUTBOUND — a public `chat-media` bucket URL (migration 023). Plain
 *      https that the browser fetches and caches like any other image.
 *
 * The thumbnail, the lightbox and a download all want the same bytes. For
 * (1) that would otherwise be three separate multi-MB round trips through
 * Meta, so proxy responses are memoised here.
 *
 * `Blob`s are cached, NOT object URLs: every consumer mints its own object
 * URL from the cached blob and revokes it on unmount. That way an LRU
 * eviction can never yank a URL out from under a mounted `<img>` — an
 * object URL keeps its blob's data alive by itself.
 */

/** Prefix of the auth-gated proxy — these need a credentialed fetch. */
const PROXY_PREFIX = "/api/whatsapp/media/";

/**
 * How many blobs to hold. Worst case is a thread that's nothing but
 * photos; 30 entries against the 5 MB image cap (`MEDIA_MAX_BYTES_BY_KIND`
 * in `@/lib/storage/upload-media`) bounds the footprint while comfortably
 * covering "scroll back, page through the last dozen photos".
 */
const MAX_CACHED = 30;

/** Insertion-ordered, so Map iteration order gives us LRU for free. */
const cache = new Map<string, Blob>();

/** In-flight loads, so N consumers of one URL share a single request. */
const inFlight = new Map<string, Promise<Blob>>();

/** Minimal `fetch` shape — injectable so the cache is testable. */
export type MediaFetch = (url: string) => Promise<Response>;

const defaultFetch: MediaFetch = (url) => fetch(url);

/**
 * The request completed and the server refused it — a 401 on inbound media
 * Meta has since expired, a 404, a 5xx. Distinct from a fetch that never
 * completed at all (offline, CORS), because those two deserve different
 * handling: see `downloadMediaMessage`.
 */
export class MediaResponseError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Media request failed (${status})`);
    this.name = "MediaResponseError";
    this.status = status;
  }
}

/** True for inbound media that has to be pulled through our proxy. */
export function isProxiedMediaUrl(url: string): boolean {
  return url.startsWith(PROXY_PREFIX);
}

function remember(url: string, blob: Blob): void {
  cache.set(url, blob);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Fetch the bytes behind a `media_url`.
 *
 * Proxy URLs are cached (and concurrent callers de-duplicated); public
 * bucket URLs are fetched straight through, since the browser's own HTTP
 * cache already covers them and a 16 MB video has no business sitting in
 * a JS-side cache.
 *
 * Throws on a failed request — nothing is cached on failure, so a retry
 * genuinely retries.
 */
export async function loadMediaBlob(
  url: string,
  fetchImpl: MediaFetch = defaultFetch,
): Promise<Blob> {
  if (!isProxiedMediaUrl(url)) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new MediaResponseError(res.status);
    return res.blob();
  }

  const cached = cache.get(url);
  if (cached) {
    // Refresh recency — re-inserting moves it to the end of the Map.
    cache.delete(url);
    cache.set(url, cached);
    return cached;
  }

  const pending = inFlight.get(url);
  if (pending) return pending;

  const load = (async () => {
    const res = await fetchImpl(url);
    if (!res.ok) throw new MediaResponseError(res.status);
    const blob = await res.blob();
    remember(url, blob);
    return blob;
  })();

  inFlight.set(url, load);
  try {
    return await load;
  } finally {
    inFlight.delete(url);
  }
}

/** Test seam — drops everything the cache is holding. */
export function __resetMediaBlobCache(): void {
  cache.clear();
  inFlight.clear();
}
