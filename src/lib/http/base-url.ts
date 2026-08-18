// ============================================================
// Resolve the public base URL a server-side request should build
// absolute links under (invite links, auth email redirects, etc.).
//
// Extracted from `POST /api/account/invitations` (team invites) so
// `POST /api/admin/companies` (platform company invites) and
// `/auth/callback` (password recovery + invite landing) share the
// exact same, already-hardened resolution instead of each growing
// their own — the naive `new URL(request.url).origin` these call
// sites used to write (or that a fresh one might reach for) resolves
// to the container's *internal* bind address behind a reverse proxy
// that doesn't rewrite the raw request URL (confirmed on EasyPanel:
// links came back as `https://0.0.0.0:80/...`, unreachable for the
// recipient) instead of the public hostname.
//
// Resolution order, first match wins:
//
//   1. `NEXT_PUBLIC_SITE_URL` — admin's explicit config. Trumps
//      everything; if you set this, that's where links point.
//   2. `X-Forwarded-Host` (+ `X-Forwarded-Proto`) — set by every
//      reverse proxy in front of the app: EasyPanel, Hostinger
//      Managed Node.js, Vercel, Cloudflare, nginx. This is what
//      makes links Just Work in production without forcing the
//      operator to set an env var.
//   3. `Host` header + the protocol the request arrived on —
//      bare deployments without a proxy.
//   4. Last-resort marketing-site fallback. Only hit if the
//      request has no Host header at all, which is essentially
//      impossible from a real browser. Logs a warning so the
//      operator can spot the misconfig.
//
// Defense-in-depth: `ALLOWED_INVITE_HOSTS`
//
//   The request-header path (#2 and #3 above) trusts whatever
//   hostname the client (or proxy) puts in the header. On a
//   typical proxied deploy (EasyPanel / Vercel / Hostinger /
//   Cloudflare) the proxy overwrites these so they're trustworthy.
//   On a bare deployment exposed to the public internet, an
//   attacker could POST directly with a crafted `Host:
//   phishing.example` and receive a redirect URL pointing at their
//   site.
//
//   When `ALLOWED_INVITE_HOSTS` is set (comma-separated hostnames),
//   we validate the derived host against the list. Anything not on
//   the list falls through to the wacrm.tech fallback with a loud
//   console.warn. Operators who care about this attack surface
//   should set this to their canonical hostnames; everyone else
//   gets today's permissive behavior. The name predates this
//   module (it started as invite-only) but covers every caller here
//   — all of them build the same class of "link mailed to someone
//   who clicks it later" URL.
// ============================================================

function parseAllowedHosts(): readonly string[] | null {
  const raw = process.env.ALLOWED_INVITE_HOSTS?.trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

function isHostAllowed(
  hostname: string,
  allowList: readonly string[] | null,
): boolean {
  if (!allowList) return true; // No allow-list → permissive (legacy behavior).
  return allowList.includes(hostname.toLowerCase());
}

export function resolveBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const allowList = parseAllowedHosts();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost && isHostAllowed(forwardedHost, allowList)) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.trim();
  if (host && isHostAllowed(host, allowList)) {
    // The protocol on `request.url` is whatever the framework saw —
    // reliable for bare deployments where no proxy is rewriting it.
    const reqProto = new URL(request.url).protocol.replace(":", "");
    return `${reqProto}://${host}`;
  }

  // We fall through here when EITHER no Host header was present at
  // all (essentially impossible from a real browser) OR an
  // ALLOWED_INVITE_HOSTS list was set and neither candidate matched
  // it. The warning is the operator's signal that someone is
  // probing the API with a spoofed Host header.
  if (allowList && (forwardedHost || host)) {
    console.warn(
      "[resolveBaseUrl] rejected non-allow-listed host:",
      { forwardedHost, host, allowList },
    );
  } else {
    console.warn(
      "[resolveBaseUrl] could not derive base URL from request; falling back to marketing domain",
    );
  }
  return "https://wacrm.tech";
}
