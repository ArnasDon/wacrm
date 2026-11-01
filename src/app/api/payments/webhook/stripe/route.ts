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
 * POST /api/payments/webhook/stripe
 * Listens for checkout.session.completed events from Stripe
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get('stripe-signature');

    let event: Record<string, unknown> = {};
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const dataObj = event.data as Record<string, Record<string, unknown>> | undefined;
    const session = dataObj?.object;
    const metadata = (session?.metadata || {}) as Record<string, string>;
    const orderId = metadata.orderId;
    const accountId = metadata.accountId;

    const admin = getAdmin();

    let order: {
      id: string;
      account_id: string;
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
    } else if (session?.id) {
      const { data } = await admin
        .from('payment_orders')
        .select('*, products(title)')
        .or(`provider_payment_link_id.eq.${session.id},provider_order_id.eq.${session.id}`)
        .maybeSingle();
      order = data;
    }

    const targetAccountId = accountId || order?.account_id;

    // Security check: must resolve target account and verify HMAC signature with replay protection
    if (!targetAccountId) {
      return NextResponse.json({ error: 'Unresolvable order account' }, { status: 400 });
    }

    if (!signatureHeader) {
      return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 401 });
    }

    const config = await getGatewayConfig(targetAccountId, 'stripe');
    if (!config?.webhookSecret) {
      console.warn('Stripe webhook rejected: missing webhook secret for account');
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    // Parse t=timestamp,v1=signature
    const items = signatureHeader.split(',');
    const timestamp = items.find((i) => i.startsWith('t='))?.slice(2);
    const sig = items.find((i) => i.startsWith('v1='))?.slice(3);

    if (!timestamp || !sig) {
      return NextResponse.json({ error: 'Malformed stripe-signature header' }, { status: 400 });
    }

    // Enforce 5-minute replay tolerance
    const timestampSeconds = Number(timestamp);
    const currentSeconds = Math.floor(Date.now() / 1000);
    if (isNaN(timestampSeconds) || Math.abs(currentSeconds - timestampSeconds) > 300) {
      console.warn('Stripe webhook rejected: timestamp outside 300s replay window');
      return NextResponse.json({ error: 'Timestamp expired' }, { status: 400 });
    }

    const payload = `${timestamp}.${rawBody}`;
    const expectedSig = crypto
      .createHmac('sha256', config.webhookSecret)
      .update(payload)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSig);
    const sigBuf = Buffer.from(sig);

    if (
      expectedBuf.length !== sigBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, sigBuf)
    ) {
      console.warn('Stripe webhook signature mismatch');
      return NextResponse.json({ error: 'Signature mismatch' }, { status: 400 });
    }

    if (event.type === 'checkout.session.completed') {
      if (order && order.status !== 'paid') {
        await admin
          .from('payment_orders')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
          })
          .eq('id', order.id);

        if (order.conversation_id) {
          const currencySymbol = order.currency === 'INR' ? '₹' : `${order.currency} `;
          const itemTitle = order.products?.title || 'your order';
          const refId = (session?.id as string) || order.id.slice(0, 8);

          const receiptMessage = `✅ *Payment Received!*\n\nWe have received your payment of *${currencySymbol}${Number(order.amount).toLocaleString()}* for *${itemTitle}*.\n\nStripe Reference: \`${refId}\`\nStatus: *Completed*\n\nThank you for your purchase!`;

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
    console.error('Stripe webhook processing error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Webhook error' },
      { status: 500 }
    );
  }
}
