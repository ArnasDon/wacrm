// ============================================================
// Products — payment webhook signature verification + payload
// parsing.
//
// The webhook is provider-agnostic: any gateway can call
// `/api/payments/webhook?account_id=…` as long as it authenticates
// with the account's webhook secret (Settings → Payments). Two
// equally-supported auth schemes:
//
//   1. `x-wacrm-signature: sha256=<hex>` — HMAC-SHA256 of the RAW
//      request body keyed with the secret (Stripe-style; robust
//      against body tampering and replay of a different payload).
//   2. `x-wacrm-secret: <secret>` — bearer fallback for gateways
//      that can't sign raw bodies (compared in constant time).
//
// All functions are pure (aside from node:crypto) so they're
// unit-testable without a database.
// ============================================================

import { createHmac, timingSafeEqual } from "crypto";

export const WEBHOOK_SIGNATURE_HEADER = "x-wacrm-signature";
export const WEBHOOK_SECRET_HEADER = "x-wacrm-secret";

export function computeWebhookSignature(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** Constant-time string comparison (length-mismatch safe). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
  bearerSecret: string | null,
): boolean {
  const header = signatureHeader?.trim() ?? "";
  if (header.startsWith("sha256=")) {
    const expected = computeWebhookSignature(secret, rawBody);
    return constantTimeEqual(header.slice("sha256=".length).toLowerCase(), expected);
  }
  const bearer = bearerSecret?.trim();
  if (bearer) return constantTimeEqual(bearer, secret);
  return false;
}

// ------------------------------------------------------------
// Payload parsing
// ------------------------------------------------------------

export type WebhookOrderStatus = "paid" | "cancelled" | "failed" | "unknown" | null;

export interface ParsedWebhookPayload {
  /** Order identifier the callback echoes back (e.g. `wacrm_<uuid>`). */
  reference: string | null;
  /** Which state the callback declares; `null` = status-agnostic. */
  status: WebhookOrderStatus;
  /** Gateway name for the orders table (stripe, paypal, …). */
  provider: string | null;
  /** Opaque snapshot of the payload, stored on the order for audit. */
  metadata: Record<string, unknown>;
}

// Keys we accept as the order reference, in priority order. Kept
// explicit — deliberately NOT a catch-all `id` scan, which would
// happily match a gateway's transaction id or a random event uuid.
const REFERENCE_KEYS = [
  "payment_reference",
  "order_reference",
  "order_id",
  "reference",
] as const;

const STATUS_KEYS = ["status", "state", "event", "type"] as const;

const PAID_WORDS = new Set([
  "paid",
  "succeeded",
  "success",
  "successful",
  "complete",
  "completed",
  "captured",
  "approved",
  "accepted",
]);
const CANCELLED_WORDS = new Set([
  "cancelled",
  "canceled",
  "voided",
  "refunded",
  "expired",
  "reversed",
]);
const FAILED_WORDS = new Set(["failed", "declined", "denied", "error", "abandoned", "incomplete"]);

function readString(obj: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = obj?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function classify(statusValue: string | null): WebhookOrderStatus {
  if (!statusValue) return "unknown";
  const normalized = statusValue.toLowerCase();
  // Event-style values like "charge.succeeded" / "payment.canceled".
  const pieces = normalized.split(/[.:_\s-]+/);
  for (const word of pieces) {
    if (PAID_WORDS.has(word)) return "paid";
    if (CANCELLED_WORDS.has(word)) return "cancelled";
    if (FAILED_WORDS.has(word)) return "failed";
  }
  return "unknown";
}

function extractStatus(payload: Record<string, unknown>): WebhookOrderStatus {
  for (const key of STATUS_KEYS) {
    const raw = readString(payload, key) ?? readString(payload.data as Record<string, unknown>, key);
    if (raw) return classify(raw);
  }
  return null;
}

function extractProvider(payload: Record<string, unknown>): string | null {
  return (
    readString(payload, "provider") ??
    readString(payload.data as Record<string, unknown>, "provider") ??
    readString(payload.data as Record<string, unknown>, "payment_provider") ??
    readString(payload, "gateway")
  );
}

function extractReference(payload: Record<string, unknown>): string | null {
  // Top-level first, then the common nesting spots gateways use.
  const data = payload.data as Record<string, unknown> | undefined;
  const nested: Record<string, unknown> = {
    ...(data ?? {}),
    ...((data?.metadata ?? payload.metadata) as Record<string, unknown> | undefined),
  };
  for (const key of REFERENCE_KEYS) {
    const top = readString(payload, key);
    if (top) return top;
    const child = readString(nested, key);
    if (child) return child;
  }
  return null;
}

export function parseWebhookPayload(rawBody: string): ParsedWebhookPayload | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const payload = body as Record<string, unknown>;
  if (Array.isArray(payload)) return null;

  return {
    reference: extractReference(payload),
    status: extractStatus(payload),
    provider: extractProvider(payload),
    metadata: { ...payload },
  };
}
