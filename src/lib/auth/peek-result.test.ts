import { describe, expect, it } from 'vitest';
import { RETRYABLE_PEEK_FAIL_REASONS, toPeekResult } from './peek-result';

describe('toPeekResult', () => {
  it('maps the rate-limit body, which has no ok or reason, to rate_limited', () => {
    expect(
      toPeekResult(429, { error: 'Too many requests', retry_after_seconds: 42 }),
    ).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('forwards a valid invitation', () => {
    const body = {
      ok: true,
      account_name: 'Acme',
      role: 'agent',
      expires_at: '2026-10-20T00:00:00Z',
    };
    expect(toPeekResult(200, body)).toEqual(body);
  });

  it.each(['not_found', 'used', 'expired', 'server_error'])(
    'forwards the %s failure reason',
    (reason) => {
      expect(toPeekResult(200, { ok: false, reason })).toEqual({ ok: false, reason });
    },
  );

  it('treats an unknown failure reason as a server error', () => {
    expect(toPeekResult(200, { ok: false, reason: 'mystery' })).toEqual({
      ok: false,
      reason: 'server_error',
    });
  });

  it('treats an unparseable body as a server error', () => {
    expect(toPeekResult(502, null)).toEqual({ ok: false, reason: 'server_error' });
    expect(toPeekResult(500, { error: 'boom' })).toEqual({
      ok: false,
      reason: 'server_error',
    });
  });

  it('offers a retry for transient failures only', () => {
    expect(RETRYABLE_PEEK_FAIL_REASONS.has('rate_limited')).toBe(true);
    expect(RETRYABLE_PEEK_FAIL_REASONS.has('server_error')).toBe(true);
    expect(RETRYABLE_PEEK_FAIL_REASONS.has('expired')).toBe(false);
  });
});
