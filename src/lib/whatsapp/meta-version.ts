/**
 * Single source of truth for the Meta Graph API version.
 *
 * Override with the server-side `META_API_VERSION` env var (format
 * `vNN.N`). It is not a `NEXT_PUBLIC_*` variable, so changing it only
 * needs a restart, not a rebuild.
 *
 * Note: once a version expires, Meta does not return an error — calls are
 * served by the oldest still-supported version, so behaviour can change
 * silently. Check the dates at
 * https://developers.facebook.com/docs/graph-api/changelog/versions
 */
export const DEFAULT_META_API_VERSION = 'v21.0';

const VERSION_FORMAT = /^v\d{1,3}\.\d$/;

/** Returns the configured version, falling back to the default if unset or malformed. */
export function metaApiVersion(
  raw: string | undefined = process.env.META_API_VERSION
): string {
  const value = raw?.trim();
  return value && VERSION_FORMAT.test(value) ? value : DEFAULT_META_API_VERSION;
}

export function metaApiBase(version: string = metaApiVersion()): string {
  return `https://graph.facebook.com/${version}`;
}
