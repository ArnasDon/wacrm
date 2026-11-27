import { describe, expect, it } from 'vitest';
import {
  advanceOrderDraft,
  orderSummary,
  type OrderDraft,
} from './order-draft';
import { parseCatalogOrder } from './text-order-parser';

const catalog = [
  { id: 'meat', nome: 'Carne', preco: 14, aliases: ['carne'] },
  {
    id: 'romeu',
    nome: 'Romeu e Julieta',
    preco: 14.5,
    aliases: ['romeu e julieta'],
  },
];
const initial = (): OrderDraft => ({
  id: 'draft',
  version: 0,
  stage: 'collecting',
  items: [],
  unresolved: [],
  total: 0,
});
const vanessa = '03 carne\n01 Romeu e Julieta\nBem passadas!!!';
const address = 'Rua Cruzeiro do Sul 352, Vila Leopoldina';

describe('standalone trailing note belongs to the whole order', () => {
  it('invalidates the displayed version when an explicit correction changes a note without changing quantity', () => {
    const first = advanceOrderDraft(
      initial(),
      `${vanessa}\n${address}`,
      catalog
    ).draft;
    const frozen = structuredClone(first);
    const result = advanceOrderDraft(
      first,
      'altere linha 1 para 3 carne sem cebola',
      catalog
    );
    expect(result.draft.stage).toBe('awaiting_confirmation');
    expect(result.draft.items.map((item) => item.quantity)).toEqual([3, 1]);
    expect(result.draft.items.map((item) => item.notes)).toEqual([
      'sem cebola',
      'Bem passadas!!!',
    ]);
    expect(result.draft.version).toBeGreaterThan(first.version);
    expect(result.checkout).toBe(false);
    expect(result.reply).toContain('Resumo do pedido');
    expect(result.reply).not.toContain('Obs. do pedido:');
    expect(first).toEqual(frozen);
    expect(
      advanceOrderDraft(result.draft, 'confirmo o pedido', catalog).checkout
    ).toBe(true);
  });

  it('retains the one-line summary after serializing the existing draft structure', () => {
    const first = advanceOrderDraft(initial(), vanessa, catalog).draft;
    const restored = JSON.parse(JSON.stringify(first)) as OrderDraft;
    const result = advanceOrderDraft(restored, address, catalog);
    expect(result.draft.items.map((item) => item.notes)).toEqual([
      'Bem passadas!!!',
      'Bem passadas!!!',
    ]);
    expect(result.reply.match(/Obs\. do pedido:/g)).toHaveLength(1);
    expect(result.draft.stage).toBe('awaiting_confirmation');
    expect(result.checkout).toBe(false);
  });

  it('accepts CRLF standalone notes but not a note between two item lines as order-wide', () => {
    const global = parseCatalogOrder(
      '2 carne\r\n1 romeu e julieta\r\nBem passadas!!!',
      catalog
    );
    expect(global.items.map((item) => item.notes)).toEqual([
      'Bem passadas!!!',
      'Bem passadas!!!',
    ]);
    const local = parseCatalogOrder(
      '2 carne\nbem passada\n1 romeu e julieta',
      catalog
    );
    expect(local.items.map((item) => item.notes)).toEqual([
      'bem passada',
      undefined,
    ]);
  });

  it('keeps a same-line observation on meat only', () => {
    const result = advanceOrderDraft(
      initial(),
      '2 carne bem passada\n1 romeu e julieta',
      catalog
    );
    expect(result.draft.items.map((item) => item.notes)).toEqual([
      'bem passada',
      undefined,
    ]);
    expect(result.draft.stage).toBe('awaiting_address');
    expect(orderSummary(result.draft)).toBe(
      '1. 2x Carne\n📝 Obs.: bem passada\n2. 1x Romeu e Julieta'
    );
  });

  it('preserves inline notes while applying safe standalone notes to all items', () => {
    const result = advanceOrderDraft(
      initial(),
      '2 carne bem passada\n1 romeu e julieta\nsem cebola',
      catalog
    );
    expect(result.draft.stage).toBe('awaiting_address');
    expect(result.draft.items.map((item) => item.notes)).toEqual([
      'bem passada\nsem cebola',
      'sem cebola',
    ]);
    expect(orderSummary(result.draft)).toBe(
      '1. 2x Carne\n📝 Obs.: bem passada\n2. 1x Romeu e Julieta\n📝 Obs. do pedido: sem cebola'
    );
  });

  it('keeps every multiline local note in the brief reply with one global note', () => {
    const previous = initial();
    const before = structuredClone(previous);
    const result = advanceOrderDraft(
      previous,
      '2 carne bem passada\nsem cebola\n1 romeu e julieta\nsem ovo',
      catalog
    );
    expect(result.draft.stage).toBe('awaiting_address');
    expect(result.checkout).toBe(false);
    expect(result.draft.items.map((item) => item.notes)).toEqual([
      'bem passada\nsem cebola\nsem ovo',
      'sem ovo',
    ]);
    expect(previous).toEqual(before);
    const snapshot = structuredClone(result.draft);
    expect(result.reply).toContain('📝 Obs.: bem passada; sem cebola');
    expect(result.reply.match(/sem ovo/g)).toHaveLength(1);
    expect(result.reply.match(/Obs\. do pedido:/g)).toHaveLength(1);
    expect(orderSummary(result.draft)).toBe(
      '1. 2x Carne\n📝 Obs.: bem passada; sem cebola\n2. 1x Romeu e Julieta\n📝 Obs. do pedido: sem ovo'
    );
    expect(result.draft).toEqual(snapshot);
  });

  it('applies each safe trailing line once, including to a one-item order', () => {
    const result = advanceOrderDraft(
      initial(),
      '2 carne\nbem passada\nsem cebola',
      catalog
    );
    expect(result.draft.stage).toBe('awaiting_address');
    expect(result.draft.items[0].notes).toBe('bem passada\nsem cebola');
    expect(orderSummary(result.draft)).toBe(
      '1. 2x Carne\n📝 Obs. do pedido: bem passada; sem cebola'
    );
  });

  it('applies the order note to previously collected items as well as the new item', () => {
    const first = advanceOrderDraft(initial(), '2 carne', catalog).draft;
    const before = structuredClone(first);
    const result = advanceOrderDraft(
      first,
      '1 romeu e julieta\nBem passadas!!!',
      catalog
    );
    expect(result.draft.items.map((item) => item.notes)).toEqual([
      'Bem passadas!!!',
      'Bem passadas!!!',
    ]);
    expect(result.draft.items.map((item) => item.quantity)).toEqual([2, 1]);
    expect(first).toEqual(before);
    expect(result.draft.version).toBeGreaterThan(first.version);
    expect(result.checkout).toBe(false);
  });

  it.each([
    '2 carne\n1 romeu e julieta\npode ser sem glúten?',
    '2 carne pode ser sem glúten?\n1 romeu e julieta\nbem passada',
    '2 carne\n1 romeu e julieta\nbem passada\nconfirma o pedido',
    '2 carne\n1 romeu e julieta\nbem passada\n1 lagosta',
  ])(
    'never drops an unsupported instruction when promoting safe lines: %s',
    (text) => {
      const result = advanceOrderDraft(initial(), text, catalog);
      expect(result.draft.stage).toBe('needs_human');
      expect(
        advanceOrderDraft(result.draft, 'confirmo o pedido', catalog).checkout
      ).toBe(false);
      expect(JSON.stringify(result.draft)).toMatch(
        /glúten|confirma o pedido|lagosta/
      );
    }
  );

  it.each([false, true])(
    'copies Vanessa note to both items, with address=%s',
    (withAddress) => {
      const text = vanessa + (withAddress ? `\n${address}` : '');
      const parsed = parseCatalogOrder(text, catalog);
      expect(parsed.items.map((item) => item.notes)).toEqual([
        'Bem passadas!!!',
        'Bem passadas!!!',
      ]);
      expect(parsed.requiresKitchenReview).toBe(false);
      const result = advanceOrderDraft(initial(), text, catalog);
      expect(result.draft.stage).toBe(
        withAddress ? 'awaiting_confirmation' : 'awaiting_address'
      );
      expect(result.draft.unresolved).toEqual([]);
      expect(result.checkout).toBe(false);
      expect(orderSummary(result.draft)).toBe(
        '1. 3x Carne\n2. 1x Romeu e Julieta\n📝 Obs. do pedido: Bem passadas!!!'
      );
      expect(result.reply.match(/Obs\. do pedido:/g)).toHaveLength(1);
      expect(Object.keys(result.draft).sort()).toEqual(
        [
          ...Object.keys(initial()),
          ...(withAddress ? ['deliveryAddress', 'deliveryKind'] : []),
        ].sort()
      );
    }
  );
});
