import { describe, it, expect } from 'vitest';

describe('Phase 2: WhatsApp Webhook Deduplication & Monotonicity', () => {
  const RECIPIENT_STATUS_LADDER = [
    'pending',
    'sent',
    'delivered',
    'read',
    'replied',
  ] as const;

  function ladderLevel(s: string): number {
    const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s);
    return idx < 0 ? -1 : idx;
  }

  function isValidStatusTransition(current: string, incoming: string): boolean {
    if (incoming === 'failed') {
      return current === 'pending' || current === 'sent';
    }
    if (current === 'failed') {
      return false;
    }
    const ci = ladderLevel(current);
    const ii = ladderLevel(incoming);
    if (ii < 0) return false;
    if (ci < 0) return true;
    return ii > ci;
  }

  it('allows forward transitions along status ladder', () => {
    expect(isValidStatusTransition('sent', 'delivered')).toBe(true);
    expect(isValidStatusTransition('delivered', 'read')).toBe(true);
    expect(isValidStatusTransition('read', 'replied')).toBe(true);
  });

  it('rejects backwards regressions (delivered after read)', () => {
    expect(isValidStatusTransition('read', 'delivered')).toBe(false);
    expect(isValidStatusTransition('delivered', 'sent')).toBe(false);
    expect(isValidStatusTransition('replied', 'read')).toBe(false);
  });

  it('rejects terminal failed status if message was already delivered or read', () => {
    expect(isValidStatusTransition('delivered', 'failed')).toBe(false);
    expect(isValidStatusTransition('read', 'failed')).toBe(false);
    expect(isValidStatusTransition('sent', 'failed')).toBe(true);
  });
});
