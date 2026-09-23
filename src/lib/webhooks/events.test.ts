import { describe, it, expect } from 'vitest';
import {
  DEAL_WEBHOOK_EVENTS,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_DESCRIPTIONS,
  isWebhookEvent,
  normalizeEvents,
} from './events';

describe('isWebhookEvent', () => {
  it('accepts every declared event and rejects others', () => {
    for (const e of WEBHOOK_EVENTS) expect(isWebhookEvent(e)).toBe(true);
    expect(isWebhookEvent('message.deleted')).toBe(false);
    expect(isWebhookEvent('deal.deleted')).toBe(false);
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

describe('os eventos de negócio', () => {
  it('são exatamente os três decididos pelo operador (23/09/2026)', () => {
    expect([...DEAL_WEBHOOK_EVENTS]).toEqual([
      'deal.created',
      'deal.stage_changed',
      'deal.status_changed',
    ]);
  });

  it('fazem parte do vocabulário — um endpoint consegue assiná-los', () => {
    for (const e of DEAL_WEBHOOK_EVENTS) {
      expect(WEBHOOK_EVENTS).toContain(e);
      expect(isWebhookEvent(e)).toBe(true);
    }
  });

  it('são TODOS os `deal.*` do vocabulário — a entrega do funil não esquece nenhum', () => {
    // `entregar-eventos-de-funil.ts` pergunta ao banco por DEAL_WEBHOOK_EVENTS:
    // um `deal.x` novo fora desta lista seria assinável na tela e nunca sairia.
    expect(WEBHOOK_EVENTS.filter((e) => e.startsWith('deal.'))).toEqual([...DEAL_WEBHOOK_EVENTS]);
  });

  it('os três eventos do upstream continuam lá', () => {
    for (const e of ['message.received', 'message.status_updated', 'conversation.created']) {
      expect(WEBHOOK_EVENTS).toContain(e);
    }
  });
});

describe('normalizeEvents', () => {
  it('de-duplicates a valid list', () => {
    expect(
      normalizeEvents(['message.received', 'message.received', 'conversation.created'])
    ).toEqual(['message.received', 'conversation.created']);
  });

  it('aceita os eventos de negócio, misturados aos de mensagem', () => {
    expect(
      normalizeEvents(['deal.stage_changed', 'message.received', 'deal.stage_changed', 'deal.created'])
    ).toEqual(['deal.stage_changed', 'message.received', 'deal.created']);
  });

  it('rejects an unknown event', () => {
    expect(normalizeEvents(['message.received', 'nope'])).toBeNull();
    expect(normalizeEvents(['deal.created', 'deal.moved'])).toBeNull();
  });

  it('rejects a non-array and an empty array', () => {
    expect(normalizeEvents('message.received')).toBeNull();
    expect(normalizeEvents([])).toBeNull();
  });
});
