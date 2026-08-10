// ============================================================
// Products — WhatsApp message builders + order reference helpers.
//
// Pure functions only (no DB / network access) so they're trivially
// unit-testable and shared by the automations engine, the payment
// webhook and the manual Mark-as-Paid path.
// ============================================================

import type { Product, ProductOrder } from "@/types";
import { formatCurrency } from "@/lib/currency";

/** Webhook callback idempotency key: `wacrm_<order-uuid>`. */
export function buildPaymentReference(orderId: string): string {
  return `wacrm_${orderId}`;
}

/**
 * Price formatter for product messaging. The shared `formatCurrency`
 * rounds to whole units (deals are whole-dollar), but product prices
 * carry cents — so show minor units whenever the price has them,
 * otherwise keep the clean whole-number output.
 */
export function formatProductPrice(amount: number, currency: string): string {
  const value = Number(amount) || 0;
  const code = (currency || "USD").trim();
  const hasCents = Math.abs(value - Math.round(value)) > 1e-9;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return formatCurrency(value, code);
  }
}

/**
 * The message a buyer receives when the `send_product` automation
 * step fires: product pitch + price + payment link, carrying the
 * order reference so the buyer (or gateway metadata) can quote it
 * back to the webhook.
 */
export function buildPaymentMessage(order: ProductOrder, product: Product): string {
  const lines: string[] = [product.name.trim()];

  if (product.description?.trim()) {
    lines.push("", product.description.trim());
  }

  lines.push("", `💳 Price: ${formatProductPrice(order.amount, order.currency)}`);

  if (product.payment_link?.trim()) {
    lines.push("", `🔗 Pay here: ${product.payment_link.trim()}`, `🧾 Order: ${order.payment_reference ?? ""}`);
  } else {
    // No checkout link configured — still surface the reference so a
    // buyer can pay offline and quote it on follow-up.
    lines.push(`🧾 Order: ${order.payment_reference ?? ""}`);
  }

  return lines.join("\n");
}

export type FulfillmentMessageKind = "digital" | "physical" | "plain";

/**
 * The confirmation message sent once an order flips to `paid`.
 *
 * `downloadUrl` is the app's own `/api/products/download/<id>` route,
 * which mints a fresh short-lived signed storage URL on each visit —
 * so the buyer can tap it whenever they like, not just in the minute
 * after payment.
 */
export function buildFulfillmentMessage(
  order: ProductOrder,
  product: Product | null,
  downloadUrl: string | null,
): string {
  const name = product?.name ?? "your order";
  const price = formatProductPrice(order.amount, order.currency);
  const lines: string[] = [`✅ Payment received for “${name}” (${price})`];

  if (downloadUrl) {
    lines.push("", `📥 Download: ${downloadUrl}`, "", "The link is fresh for a short time — tap it while it works.");
  } else if (product?.kind === "physical") {
    lines.push("", "📦 We’ve got your order and will start shipping it shortly. We’ll message you tracking details when available.");
  } else {
    lines.push("", "Thank you for your purchase! We’ll be in touch with delivery details shortly.");
  }

  return lines.join("\n");
}
