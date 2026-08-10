// ============================================================
// Products — order lifecycle (create pending → mark paid → deliver).
//
// Shared by three callers:
//   - the automations `send_product` step (create pending order)
//   - the payment webhook (/api/payments/webhook, mark paid)
//   - the manual Mark-as-Paid path (/api/orders/[id], admin+)
//
// All writes go through the service-role client because these paths
// run server-side with no browser cookies (engine, webhook). The
// WhatsApp sends reuse the automation-side Meta sender so behaviour
// matches what the engine already does.
// ============================================================

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { engineSendText } from "@/lib/automations/meta-send";
import { getAbsoluteUrl } from "@/lib/app-url";
import type { Product, ProductOrder, ProductOrderStatus } from "@/types";
import { buildFulfillmentMessage, buildPaymentMessage, buildPaymentReference } from "./messages";

export const PRODUCT_FILE_BUCKET = "product-files";
/** Short-lived signed URLs; the download route re-mints on each visit. */
export const DOWNLOAD_URL_TTL_SECONDS = 600;

export interface CreatePendingOrderInput {
  accountId: string;
  userId: string;
  productId: string;
  contactId: string | null;
  conversationId: string | null;
  /** Gateway name when the order is created from a callback-driven flow. */
  paymentProvider?: string | null;
}

/**
 * Create a `pending` order for a buyer. The order id is generated
 * client-side so `payment_reference` (wacrm_<id>) can be stamped in
 * the same INSERT — the webhook's idempotency key.
 *
 * Returns the created order plus the product it was built from, so
 * the caller can send the payment-pitch message without a second
 * lookup. Failures throw — the caller surfaces them as a failed
 * automation step.
 */
export async function createPendingOrder(
  input: CreatePendingOrderInput,
): Promise<{ order: ProductOrder; product: Product }> {
  const db = supabaseAdmin();

  const { data: product, error: pErr } = await db
    .from("products")
    .select("*")
    .eq("id", input.productId)
    .eq("account_id", input.accountId)
    .maybeSingle();
  if (pErr || !product) {
    throw new Error(`send_product: product not found (id=${input.productId})`);
  }
  if (!product.is_active) {
    throw new Error(`send_product: product is inactive (id=${input.productId})`);
  }

  const orderId = crypto.randomUUID();
  const reference = buildPaymentReference(orderId);

  const { data: order, error: oErr } = await db
    .from("product_orders")
    .insert({
      id: orderId,
      account_id: input.accountId,
      user_id: input.userId,
      product_id: product.id,
      contact_id: input.contactId ?? null,
      conversation_id: input.conversationId ?? null,
      payment_reference: reference,
      status: "pending",
      amount: Number(product.price) || 0,
      currency: product.currency || "USD",
      payment_provider: input.paymentProvider ?? null,
      metadata: {
        product_snapshot: {
          name: product.name,
          description: product.description,
          kind: product.kind,
          payment_link: product.payment_link,
        },
      },
    })
    .select()
    .single();
  if (oErr || !order) {
    throw new Error(`send_product: order insert failed: ${oErr?.message ?? "no row returned"}`);
  }

  return { order: order as ProductOrder, product: product as Product };
}

/** Send the payment-pitch message for an order. Returns the Meta message id. */
export async function sendPaymentMessage(
  order: ProductOrder,
  product: Product,
): Promise<{ whatsapp_message_id: string }> {
  if (!order.conversation_id || !order.contact_id) {
    throw new Error("send_product: order has no conversation/contact to message");
  }
  return engineSendText({
    accountId: order.account_id,
    userId: order.user_id,
    conversationId: order.conversation_id,
    contactId: order.contact_id,
    text: buildPaymentMessage(order, product),
  });
}

export interface MarkOrderStatusInput {
  orderId: string;
  status: ProductOrderStatus;
  /** Gateway name for the orders table ('manual', 'stripe', …). */
  provider?: string | null;
}

/**
 * Flip an order to a terminal state and, when it's `paid`, deliver
 * the confirmation + download link over WhatsApp.
 *
 * Idempotent by design: the webhook is replayed by gateways, so a
 * `paid` order short-circuits before any write or send.
 */
export async function setOrderStatus(input: MarkOrderStatusInput): Promise<ProductOrder> {
  const db = supabaseAdmin();

  const { data: order, error: orderErr } = await db
    .from("product_orders")
    .select("*, product:products(*)")
    .eq("id", input.orderId)
    .maybeSingle();
  if (orderErr || !order) {
    throw new Error(`order not found (id=${input.orderId})`);
  }

  // No-op on repeat callbacks — payment already recorded.
  if (order.status === input.status) {
    return order as ProductOrder;
  }

  const now = new Date().toISOString();
  const isPaid = input.status === "paid";
  const update = {
    status: input.status,
    paid_at: isPaid ? now : null,
    payment_provider: input.provider ?? order.payment_provider ?? (isPaid ? "webhook" : null),
    updated_at: now,
  };
  const { error: uErr } = await db.from("product_orders").update(update).eq("id", order.id);
  if (uErr) {
    throw new Error(`order update failed: ${uErr.message}`);
  }

  if (isPaid) {
    await deliverConfirmation(order as ProductOrder, order.product as Product | null, now);
  }

  return { ...order, ...update, product: order.product } as ProductOrder;
}

/**
 * WhatsApp the buyer their confirmation + download link. Best-effort:
 * the order is already marked paid — a failed send must NOT fail the
 * webhook callback (gateways retry forever on 5xx), so failures are
 * logged and swallowed.
 */
async function deliverConfirmation(
  order: ProductOrder,
  product: Product | null,
  paidAt: string,
): Promise<void> {
  const conversationId =
    order.conversation_id ??
    (order.contact_id ? await resolveConversationIdForContact(order.account_id, order.contact_id) : null);
  if (!conversationId || !order.contact_id) {
    console.warn("[products] no conversation for paid order, skipping confirmation", order.id);
    return;
  }

  const downloadUrl =
    product?.kind === "digital" && product.file_path
      ? getAbsoluteUrl(`/api/products/download/${order.id}`)
      : null;

  try {
    await engineSendText({
      accountId: order.account_id,
      userId: order.user_id,
      conversationId,
      contactId: order.contact_id,
      text: buildFulfillmentMessage({ ...order, paid_at: paidAt }, product, downloadUrl),
    });
  } catch (err) {
    console.error("[products] confirmation message failed:", order.id, err);
  }
}

/** Mints a fresh short-lived signed URL for a stored product file. */
export async function createSignedDownloadUrl(
  path: string,
  expiresInSeconds: number = DOWNLOAD_URL_TTL_SECONDS,
): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .storage.from(PRODUCT_FILE_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`failed to create signed download url: ${error?.message ?? "no url returned"}`);
  }
  return data.signedUrl;
}

async function resolveConversationIdForContact(accountId: string, contactId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("conversations")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}
