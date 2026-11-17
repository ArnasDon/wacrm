import { describe, it, expect } from 'vitest';
import {
  generateWebhookSecret,
  serializeWebhookEndpoint,
  checkWebhookUrl,
  WEBHOOK_SECRET_PREFIX,
} from './endpoints';

describe('generateWebhookSecret', () => {
  it('is prefixed and high-entropy, and unique per call', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(a.length).toBeGreaterThan(WEBHOOK_SECRET_PREFIX.length + 20);
    expect(a).not.toBe(b);
  });
});

describe('serializeWebhookEndpoint', () => {
  it('projects public fields and never leaks the secret', () => {
    const out = serializeWebhookEndpoint({
      id: 'w1',
      account_id: 'acct',
      created_by: 'u1',
      url: 'https://example.com/hook',
      secret: 'encrypted-blob',
      events: ['message.received'],
      is_active: true,
      last_delivery_at: null,
      failure_count: 0,
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(out).not.toHaveProperty('secret');
    expect(out).not.toHaveProperty('account_id');
    expect(out).toEqual({
      id: 'w1',
      url: 'https://example.com/hook',
      events: ['message.received'],
      is_active: true,
      last_delivery_at: null,
      failure_count: 0,
      created_at: '2026-01-01T00:00:00Z',
    });
  });
});

describe('checkWebhookUrl', () => {
  it('accepts https and normalizes', () => {
    expect(checkWebhookUrl('  https://example.com/hook  ')).toEqual({
      ok: true,
      url: 'https://example.com/hook',
    });
  });

  it('rejects http, non-URLs, and non-strings', () => {
    expect(checkWebhookUrl('http://example.com/hook').ok).toBe(false);
    expect(checkWebhookUrl('not a url').ok).toBe(false);
    expect(checkWebhookUrl(123).ok).toBe(false);
  });

  it('rejects URLs with embedded credentials with a specific message', () => {
    for (const url of [
      'https://user:pass@example.com/hook',
      'https://user@example.com/hook',
      'https://:secret@example.com/hook',
    ]) {
      const result = checkWebhookUrl(url);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/username or password/);
    }
  });
});
