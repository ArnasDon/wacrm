import { describe, it, expect, beforeAll } from 'vitest';
import {
  signCatalogConversation,
  verifyCatalogConversation,
} from './catalog-link-token';

beforeAll(() => {
  process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ?? 'a'.repeat(64);
});

describe('catalog-link-token', () => {
  const CONV = '11111111-2222-3333-4444-555555555555';

  it('round-trips a conversation id through sign → verify', () => {
    const token = signCatalogConversation(CONV);
    expect(token.startsWith(`${CONV}.`)).toBe(true);
    expect(verifyCatalogConversation(token)).toBe(CONV);
  });

  it('rejects a token whose id was swapped (signature no longer matches)', () => {
    const token = signCatalogConversation(CONV);
    const sig = token.slice(token.lastIndexOf('.'));
    const forged = `99999999-8888-7777-6666-555555555555${sig}`;
    expect(verifyCatalogConversation(forged)).toBeNull();
  });

  it('rejects a raw, unsigned id (old-style link)', () => {
    expect(verifyCatalogConversation(CONV)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = signCatalogConversation(CONV);
    const tampered = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    expect(verifyCatalogConversation(tampered)).toBeNull();
  });

  it('returns null for empty / missing / malformed input', () => {
    expect(verifyCatalogConversation(null)).toBeNull();
    expect(verifyCatalogConversation(undefined)).toBeNull();
    expect(verifyCatalogConversation('')).toBeNull();
    expect(verifyCatalogConversation('no-dot-here')).toBeNull();
    expect(verifyCatalogConversation('.onlysig')).toBeNull();
  });
});
