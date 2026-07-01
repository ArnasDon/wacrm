import { describe, it, expect } from 'vitest';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_DESCRIPTIONS,
  isWebhookEvent,
  normalizeEvents,
} from './events';

describe('isWebhookEvent', () => {
  it('accepts every declared event and rejects others', () => {
    for (const e of WEBHOOK_EVENTS) expect(isWebhookEvent(e)).toBe(true);
    expect(isWebhookEvent('message.deleted')).toBe(false);
    expect(isWebhookEvent(42)).toBe(false);
  });
});

describe('every event has a description', () => {
  it('covers the vocabulary', () => {
    for (const e of WEBHOOK_EVENTS) {
      expect(WEBHOOK_EVENT_DESCRIPTIONS[e]).toBeTruthy();
    }
  });
});

describe('normalizeEvents', () => {
  it('de-duplicates a valid list', () => {
    expect(
      normalizeEvents(['message.received', 'message.received', 'conversation.created'])
    ).toEqual(['message.received', 'conversation.created']);
  });

  it('rejects an unknown event', () => {
    expect(normalizeEvents(['message.received', 'nope'])).toBeNull();
  });

  it('rejects a non-array and an empty array', () => {
    expect(normalizeEvents('message.received')).toBeNull();
    expect(normalizeEvents([])).toBeNull();
  });
});
