// ============================================================
// App base-URL resolution for server-side link building.
//
// The fulfilment flow has to hand buyers absolute URLs (download
// links, payment links) but runs without a Request object (the
// automations engine / webhook). Resolution order, first match wins:
//
//   1. `NEXT_PUBLIC_SITE_URL` — the operator's explicit config,
//      already the app's canonical "external links point here" knob
//      (invitations route uses it the same way).
//   2. `NEXT_PUBLIC_APP_URL` — alias kept for self-hosted deploys
//      that only know their dashboard host.
//   3. `VERCEL_URL` — Vercel deployments get this for free.
//
// When nothing is configured we return the bare path — degraded,
// but a link that 404s beats a build that crashes. The Settings
// → Payments panel surfaces this env requirement so operators
// know to set it before product sales go live.
// ============================================================

export function getAppBaseUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL)?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;

  return "";
}

/** Absolute URL for a path, or the bare path when no base is known. */
export function getAbsoluteUrl(path: string): string {
  const base = getAppBaseUrl();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
