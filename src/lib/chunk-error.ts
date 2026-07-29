// ============================================================
// Stale-chunk detection.
//
// Every deploy replaces the JS chunk files in .next/static with new,
// content-hashed filenames. A tab left open from BEFORE a deploy
// still holds references to the OLD filenames — the moment it tries
// to client-side-navigate (Link/router.push) into a route segment or
// component that wasn't already loaded, the browser requests a chunk
// that no longer exists on the server (404) and the dynamic import()
// backing that navigation rejects. Next.js/webpack surfaces this as a
// `ChunkLoadError`; browsers vary the exact wording for a plain
// `import()` failure ("Failed to fetch dynamically imported module",
// Safari's "Importing a module script failed", etc.).
//
// None of this is a bug in application code — it's an unavoidable
// consequence of shipping more than one deploy while users have tabs
// open. The only real fix is a hard reload, which fetches the
// current build's HTML/JS from scratch. DO NOT remove this thinking
// it's dead code just because it never fires in a single local dev
// session — it only ever fires against a tab that's outlived a
// production deploy.
// ============================================================

const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w.-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const haystack = `${name} ${message}`;
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(haystack));
}

const RELOAD_GUARD_KEY = "wacrm:chunk-reload-attempted";

/**
 * Reloads the page to pick up the current deploy's chunks. Guarded to
 * fire at most once per tab session — if the reload itself doesn't
 * fix things (e.g. a transient CDN hiccup rather than a genuinely
 * stale build), we don't want to loop reloading forever.
 */
export function reloadForNewVersion(onBeforeReload?: () => void): void {
  if (typeof window === "undefined") return;
  if (sessionStorage.getItem(RELOAD_GUARD_KEY)) return;
  sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
  onBeforeReload?.();
  // Small delay so a toast (if the caller shows one) is visible
  // before the page tears down.
  setTimeout(() => window.location.reload(), 600);
}
