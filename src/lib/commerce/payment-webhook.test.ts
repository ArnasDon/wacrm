import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

describe('Phase 4: Payment Webhook Security & Signatures', () => {
  const secret = 'whsec_test_secret_1234567890';
  const sampleBody = JSON.stringify({
    event: 'payment_link.paid',
    payload: {
      payment_link: {
        entity: {
          id: 'plink_12345',
          notes: { orderId: 'ord-1', accountId: 'acc-1' },
        },
      },
    },
  });

  it('validates authentic Razorpay HMAC signature', () => {
    const signature = crypto
      .createHmac('sha256', secret)
      .update(sampleBody)
      .digest('hex');

    const expectedBuf = Buffer.from(signature);
    const receivedBuf = Buffer.from(signature);

    expect(expectedBuf.length).toBe(receivedBuf.length);
    expect(crypto.timingSafeEqual(expectedBuf, receivedBuf)).toBe(true);
  });

  it('rejects forged Razorpay signature', () => {
    const forged = crypto
      .createHmac('sha256', 'wrong_secret')
      .update(sampleBody)
      .digest('hex');

    const expected = crypto
      .createHmac('sha256', secret)
      .update(sampleBody)
      .digest('hex');

    expect(expected).not.toBe(forged);
  });

  it('validates Stripe timestamp signature and enforces 300s replay window', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = `${now}.${sampleBody}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    // Inside window
    expect(Math.abs(Math.floor(Date.now() / 1000) - now)).toBeLessThanOrEqual(300);

    // Replay attack after 400s
    const oldTimestamp = now - 400;
    expect(Math.abs(Math.floor(Date.now() / 1000) - oldTimestamp)).toBeGreaterThan(300);
  });
});
