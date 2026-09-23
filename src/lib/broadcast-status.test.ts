import { describe, expect, it } from 'vitest';
import {
  broadcastStatusConfig,
  getBroadcastStatus,
  getRecipientStatus,
  recipientStatusConfig,
} from './broadcast-status';

describe('getBroadcastStatus', () => {
  it('returns the matching config for known statuses', () => {
    expect(getBroadcastStatus('sending')).toBe(broadcastStatusConfig.sending);
    expect(getBroadcastStatus('sent')).toBe(broadcastStatusConfig.sent);
    expect(getBroadcastStatus('failed')).toBe(broadcastStatusConfig.failed);
  });

  it('flags `sending` as a live/pulsing state', () => {
    expect(getBroadcastStatus('sending').pulse).toBe(true);
    expect(getBroadcastStatus('sent').pulse).toBeFalsy();
  });

  it('falls back to draft on an unknown status string', () => {
    expect(getBroadcastStatus('not-a-real-status')).toBe(
      broadcastStatusConfig.draft
    );
    expect(getBroadcastStatus('')).toBe(broadcastStatusConfig.draft);
  });

  it('each variant has the dark-theme class triple', () => {
    // Accept both fixed-shade Tailwind names (bg-red-500/10) and
    // token-backed names without a shade number (bg-primary/10) since
    // the brand-accent statuses now ride the active color theme.
    for (const v of Object.values(broadcastStatusConfig)) {
      expect(v.classes).toMatch(/bg-[a-z]+(-\d+)?\/10/);
      expect(v.classes).toMatch(/text-[a-z]+(-\d+)?/);
      expect(v.classes).toMatch(/border-[a-z]+(-\d+)?\/20/);
    }
  });
});

describe('getRecipientStatus', () => {
  it('returns the matching config for known statuses', () => {
    expect(getRecipientStatus('delivered')).toBe(
      recipientStatusConfig.delivered
    );
    expect(getRecipientStatus('read')).toBe(recipientStatusConfig.read);
  });

  it('falls back to pending on an unknown status string', () => {
    expect(getRecipientStatus('???')).toBe(recipientStatusConfig.pending);
  });
});
