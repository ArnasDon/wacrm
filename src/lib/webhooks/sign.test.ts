import { describe, it, expect } from 'vitest';
import { buildSignatureHeader, verifySignatureHeader } from './sign';

const secret = 'whsec_testsecret';
const body = JSON.stringify({ event: 'message.received', data: { a: 1 } });

describe('buildSignatureHeader', () => {
  it('emits the t=,v1= shape and is deterministic', () => {
    const h1 = buildSignatureHeader(body, secret, 1_700_000_000);
    const h2 = buildSignatureHeader(body, secret, 1_700_000_000);
    expect(h1).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });
});

describe('verifySignatureHeader', () => {
  const now = 1_700_000_000;
  const header = buildSignatureHeader(body, secret, now);

  it('accepts a valid, in-tolerance signature', () => {
    expect(verifySignatureHeader(header, body, secret, now + 10)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifySignatureHeader(header, body + 'x', secret, now)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    expect(verifySignatureHeader(header, body, 'whsec_other', now)).toBe(false);
  });

  it('rejects a stale timestamp (replay protection)', () => {
    expect(verifySignatureHeader(header, body, secret, now + 10_000)).toBe(false);
  });

  it('rejects a malformed header', () => {
    expect(verifySignatureHeader('garbage', body, secret, now)).toBe(false);
  });

  it('tolerates uppercase hex and whitespace in the header', () => {
    const [, t, v1] = header.match(/^t=(\d+),v1=([0-9a-f]+)$/)!;
    const loose = `t=${t}, v1=${v1.toUpperCase()}`;
    expect(verifySignatureHeader(loose, body, secret, Number(t))).toBe(true);
  });
});
