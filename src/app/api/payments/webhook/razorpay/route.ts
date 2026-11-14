import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getGatewayConfig } from '@/lib/commerce/gateway';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';

function getAdmin() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/payments/webhook/razorpay
 * Listens for payment_link.paid / payment.captured events from Razorpay
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-razorpay-signature');

    let event: Record<string, unknown> = {};
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // Identify account / order
    const payloadObj = event.payload as Record<string, Record<string, unknown>> | undefined;
    const paymentLinkEntity = payloadObj?.payment_link?.entity as Record<string, unknown> | undefined;
    const paymentEntity = payloadObj?.payment?.entity as Record<string, unknown> | undefined;
    const notes = (paymentLinkEntity?.notes || paymentEntity?.notes || {}) as Record<string, string>;
    const orderId = typeof notes.orderId === 'string' ? notes.orderId : undefined;
    const accountId = typeof notes.accountId === 'string' ? notes.accountId : undefined;
    const paymentLinkId =
      typeof paymentLinkEntity?.id === 'string' ? paymentLinkEntity.id : undefined;

    const admin = getAdmin();

    // Look up order if orderId is available
    let order: {
      id: string;
      account_id: string;
      provider: string;
      status: string;
      amount: number;
      currency: string;
      conversation_id: string | null;
      products?: { title: string } | null;
    } | null = null;
    if (orderId) {
      const { data } = await admin
        .from('payment_orders')
        .select('*, products(title)')
        .eq('id', orderId)
        .maybeSingle();
      order = data;
    } else if (paymentLinkId) {
      const { data } = await admin
        .from('payment_orders')
        .select('*, products(title)')
        .eq('provider_payment_link_id', paymentLinkId)
        .maybeSingle();
      order = data;
    }

    if (!order) {
      return NextResponse.json({ error: 'Unknown payment order' }, { status: 400 });
    }

    if (order.provider !== 'razorpay' || (accountId && accountId !== order.account_id)) {
      console.warn('Razorpay webhook rejected: order/provider account mismatch');
      return NextResponse.json({ error: 'Invalid payment order' }, { status: 400 });
    }

    const config = await getGatewayConfig(order.account_id, 'razorpay');
    if (!config?.webhookSecret || !signature) {
      console.warn('Razorpay webhook rejected: missing webhook secret or signature header');
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    const expectedSignature = crypto
      .createHmac('sha256', config.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature);
    const signatureBuf = Buffer.from(signature);

    if (
      expectedBuf.length !== signatureBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, signatureBuf)
    ) {
      console.warn('Razorpay webhook HMAC signature mismatch');
      return NextResponse.json({ error: 'Signature mismatch' }, { status: 400 });
    }

    // Process payment success events
    const eventType = event.event;
    if (eventType === 'payment_link.paid' || eventType === 'payment.captured') {
      if (order && order.status !== 'paid') {
        // Mark payment order as paid
        await admin
          .from('payment_orders')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        // Send confirmation to conversation
        if (order.conversation_id) {
          const currencySymbol = order.currency === 'INR' ? '₹' : `${order.currency} `;
          const itemTitle = order.products?.title || 'your order';
          const txnId =
            (typeof paymentEntity?.id === 'string' && paymentEntity.id) ||
            paymentLinkId ||
            order.id.slice(0, 8);

          const receiptMessage = `✅ *Payment Received!*\n\nWe have received your payment of *${currencySymbol}${Number(order.amount).toLocaleString()}* for *${itemTitle}*.\n\nTransaction ID: \`${txnId}\`\nStatus: *Completed*\n\nThank you for your purchase!`;

          // Send confirmation over WhatsApp using core helper
          let sent = false;
          try {
            await sendMessageToConversation(admin, order.account_id, {
              conversationId: order.conversation_id,
              messageType: 'text',
              contentText: receiptMessage,
            });
            sent = true;
          } catch (sendErr) {
            console.error('Failed to dispatch receipt via sendMessageToConversation:', sendErr);
          }

          if (!sent) {
            // Fallback insert if WhatsApp not configured
            await admin.from('messages').insert({
              conversation_id: order.conversation_id,
              sender_type: 'bot',
              content_text: receiptMessage,
              content_type: 'text',
              status: 'delivered',
            });

            await admin
              .from('conversations')
              .update({
                last_message_at: new Date().toISOString(),
                last_message_text: `Payment Received: ${currencySymbol}${Number(order.amount).toLocaleString()}`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', order.conversation_id);
          }
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('Razorpay webhook processing error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Webhook error' },
      { status: 500 }
    );
  }
}
