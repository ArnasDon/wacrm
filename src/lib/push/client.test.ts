import { describe, it, expect } from 'vitest';
import { urlBase64ToUint8Array } from './client';

describe('urlBase64ToUint8Array', () => {
  it('decodes a url-safe base64 string to the right bytes', () => {
    // "hello" -> base64 "aGVsbG8=" -> url-safe "aGVsbG8" (no padding)
    const out = urlBase64ToUint8Array('aGVsbG8');
    expect(Array.from(out)).toEqual([104, 101, 108, 108, 111]);
  });

  it('handles url-safe chars (- and _) and missing padding', () => {
    // bytes [251, 255, 191] -> base64 "+/+/" -> url-safe "-_-_"
    const out = urlBase64ToUint8Array('-_-_');
    expect(Array.from(out)).toEqual([251, 255, 191]);
  });

  it('round-trips a realistic-length VAPID key', () => {
    const bytes = new Uint8Array(65).map((_, i) => (i * 7) % 256);
    const b64 = Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(Array.from(urlBase64ToUint8Array(b64))).toEqual(Array.from(bytes));
  });
});
