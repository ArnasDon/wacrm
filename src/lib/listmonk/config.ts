// ============================================================
// Listmonk connection config.
//
// wacrm talks to listmonk as a *separate service* over its REST
// API — never by importing its code or sharing its database.
// That boundary is deliberate:
//
//   1. Technical — listmonk is a Go binary with a Vue frontend.
//      There is no way to merge it into a Next.js process.
//   2. Legal — listmonk is AGPL-3.0; wacrm is MIT. Keeping
//      listmonk as an unmodified upstream service that we call
//      over HTTP keeps the AGPL scoped to listmonk itself and
//      leaves this codebase MIT. Vendoring or forking its source
//      into this repo would not.
//
// Server-only: the token is a full-privilege API credential, so
// nothing here may be imported from a client component.
// ============================================================

export interface ListmonkConfig {
  baseUrl: string;
  apiUser: string;
  apiToken: string;
}

export class ListmonkNotConfiguredError extends Error {
  readonly status = 503 as const;
  constructor(missing: string[]) {
    super(
      `Listmonk is not configured. Missing env: ${missing.join(', ')}. ` +
        `See deploy/README.md.`
    );
    this.name = 'ListmonkNotConfiguredError';
  }
}

/**
 * Read config from env. Returns null rather than throwing so callers
 * that merely want to know "is email enabled?" don't need a try/catch
 * — the Email section hides itself instead of erroring when an
 * operator has not wired listmonk up.
 */
export function getListmonkConfig(): ListmonkConfig | null {
  const baseUrl = process.env.LISTMONK_URL?.trim();
  const apiUser = process.env.LISTMONK_API_USER?.trim();
  const apiToken = process.env.LISTMONK_API_TOKEN?.trim();

  if (!baseUrl || !apiUser || !apiToken) return null;

  return {
    // Trailing slash would produce `//api/...` on join. Harmless on
    // most servers, but it breaks strict reverse-proxy path matching.
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiUser,
    apiToken,
  };
}

/** Same as getListmonkConfig, but throws a 503-shaped error. */
export function requireListmonkConfig(): ListmonkConfig {
  const cfg = getListmonkConfig();
  if (cfg) return cfg;

  const missing: string[] = [];
  if (!process.env.LISTMONK_URL?.trim()) missing.push('LISTMONK_URL');
  if (!process.env.LISTMONK_API_USER?.trim()) missing.push('LISTMONK_API_USER');
  if (!process.env.LISTMONK_API_TOKEN?.trim())
    missing.push('LISTMONK_API_TOKEN');
  throw new ListmonkNotConfiguredError(missing);
}

export function isListmonkEnabled(): boolean {
  return getListmonkConfig() !== null;
}

/**
 * Per-request timeout for listmonk calls. Campaign queries over a
 * large subscriber base can be slow, so this is more generous than a
 * typical API hop but still bounded — a hung listmonk must not pin a
 * Next.js worker open indefinitely.
 */
export const LISTMONK_TIMEOUT_MS = Number(
  process.env.LISTMONK_TIMEOUT_MS ?? 20_000
);
