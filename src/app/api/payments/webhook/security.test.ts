

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  updateEq: vi.fn(),
  getGatewayConfig: vi.fn(),
  sendMessageToConversation: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mocks.maybeSingle,
      update: vi.fn(() => ({ eq: mocks.updateEq })),
    })),
  })),
}));

vi.mock('@/lib/commerce/gateway', () => ({
  getGatewayConfig: mocks.getGatewayConfig,
}));

vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: mocks.sendMessageToConversation,
}));

import { POST as stripeWebhook } from './stripe/route';
import { POST as razorpayWebhook } from './razorpay/route';

const webhookSecret = 'test-webhook-secret';

function makeOrder(provider: string, accountId = 'account-victim') {
  return {
    id: 'order-victim',
    account_id: accountId,
    provider,
    status: 'pending',
    amount: 25,
    currency: 'USD',
    conversation_id: null,
    products: null,
  };
}

function makeStripeRequest(metadata: Record<string, string>) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_123',
        metadata,
      },
    },
  });
  const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return new NextRequest('http://localhost/api/payments/webhook/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
    body,
  });
}

function makeRazorpayRequest(notes: Record<string, string>) {
  const body = JSON.stringify({
    event: 'payment_link.paid',
    payload: {
      payment_link: {
        entity: {
          id: 'plink_test_123',
          notes,
        },
      },
    },
  });
  const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex');
  return new NextRequest('http://localhost/api/payments/webhook/razorpay', {
    method: 'POST',
    headers: { 'x-razorpay-signature': signature },
    body,
  });
}

describe('payment webhook order/account binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateEq.mockResolvedValue({ error: null });
    mocks.getGatewayConfig.mockResolvedValue({
      webhookSecret,
      isActive: true,
      provider: 'stripe',
      secretKey: 'secret',
      publishableKey: null,
    });
  });

  it('rejects Stripe metadata for a different account before processing the order', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: makeOrder('stripe'), error: null });

    const response = await stripeWebhook(
      makeStripeRequest({ orderId: 'order-victim', accountId: 'account-attacker' })
    );

    expect(response.status).toBe(400);
    expect(mocks.getGatewayConfig).not.toHaveBeenCalled();
    expect(mocks.updateEq).not.toHaveBeenCalled();
  });

  it('rejects a Stripe event when its order belongs to another provider', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: makeOrder('razorpay'), error: null });

    const response = await stripeWebhook(
      makeStripeRequest({ orderId: 'order-victim', accountId: 'account-victim' })
    );

    expect(response.status).toBe(400);
    expect(mocks.getGatewayConfig).not.toHaveBeenCalled();
    expect(mocks.updateEq).not.toHaveBeenCalled();
  });

  it('rejects Razorpay notes for a different account before processing the order', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: makeOrder('razorpay'), error: null });

    const response = await razorpayWebhook(
      makeRazorpayRequest({ orderId: 'order-victim', accountId: 'account-attacker' })
    );

    expect(response.status).toBe(400);
    expect(mocks.getGatewayConfig).not.toHaveBeenCalled();
    expect(mocks.updateEq).not.toHaveBeenCalled();
  });

  it('processes a Stripe event only with the matching order account configuration', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: makeOrder('stripe'), error: null });

    const response = await stripeWebhook(
      makeStripeRequest({ orderId: 'order-victim', accountId: 'account-victim' })
    );

    expect(response.status).toBe(200);
    expect(mocks.getGatewayConfig).toHaveBeenCalledWith('account-victim', 'stripe');
    expect(mocks.updateEq).toHaveBeenCalledWith('id', 'order-victim');
  });

  it('processes a Razorpay event only with the matching order account configuration', async () => {
    mocks.getGatewayConfig.mockResolvedValue({
      webhookSecret,
      isActive: true,
      provider: 'razorpay',
      secretKey: 'secret',
      publishableKey: null,
    });
    mocks.maybeSingle.mockResolvedValue({ data: makeOrder('razorpay'), error: null });

    const response = await razorpayWebhook(
      makeRazorpayRequest({ orderId: 'order-victim', accountId: 'account-victim' })
    );

    expect(response.status).toBe(200);
    expect(mocks.getGatewayConfig).toHaveBeenCalledWith('account-victim', 'razorpay');
    expect(mocks.updateEq).toHaveBeenCalledWith('id', 'order-victim');
  });
});
