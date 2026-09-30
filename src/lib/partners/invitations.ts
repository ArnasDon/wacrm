// ============================================================
// Partner invitation token + config helpers — server-side, pure.
//
// Tokens reuse the account-invite generator (32 bytes of CSPRNG,
// base64url, SHA-256 at rest — see src/lib/auth/invitations.ts), so
// both invite systems share one audited implementation.
// ============================================================

import { generateInviteToken, hashInviteToken } from "@/lib/auth/invitations";

export { generateInviteToken as generatePartnerToken, hashInviteToken as hashPartnerToken };

export type PartnerInvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";

export const DEFAULT_PARTNER_INVITATION_EXPIRY_HOURS = 72;
/** Upper bound so a typo in the env var can't mint year-long links. */
export const MAX_PARTNER_INVITATION_EXPIRY_HOURS = 24 * 30;

export const DEFAULT_PARTNER_RESEND_LIMIT = 3;
export const PARTNER_RESEND_WINDOW_SECONDS = 60 * 60;

function positiveIntFromEnv(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** `PARTNER_INVITATION_EXPIRY_HOURS`, default 72, clamped to [1, 720]. */
export function partnerInvitationExpiryHours(
  env: Record<string, string | undefined> = process.env,
): number {
  const hours = positiveIntFromEnv(env.PARTNER_INVITATION_EXPIRY_HOURS);
  if (hours === null) return DEFAULT_PARTNER_INVITATION_EXPIRY_HOURS;
  return Math.min(hours, MAX_PARTNER_INVITATION_EXPIRY_HOURS);
}

/** `PARTNER_INVITATION_RESEND_LIMIT` resends per hour, default 3. */
export function partnerResendLimit(
  env: Record<string, string | undefined> = process.env,
): number {
  return positiveIntFromEnv(env.PARTNER_INVITATION_RESEND_LIMIT) ?? DEFAULT_PARTNER_RESEND_LIMIT;
}

export function partnerInvitationExpiresAt(hours: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

/** `<base>/partner/signup?token=<token>` — the link emailed to the partner. */
export function partnerSignupUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/partner/signup?token=${encodeURIComponent(token)}`;
}

/**
 * The status a row should be *shown* with. A PENDING row whose
 * `expires_at` has passed is EXPIRED even if nothing has persisted
 * that yet.
 */
export function effectiveInvitationStatus(
  status: PartnerInvitationStatus,
  expiresAt: string | Date,
  now: Date = new Date(),
): PartnerInvitationStatus {
  if (status === "PENDING" && new Date(expiresAt).getTime() <= now.getTime()) {
    return "EXPIRED";
  }
  return status;
}

/** Plausibility check before hashing a token from the query string. */
export function looksLikePartnerToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}
