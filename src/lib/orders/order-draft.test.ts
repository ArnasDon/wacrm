import { describe, expect, it } from 'vitest';
import { advanceOrderDraft, type OrderDraft } from './order-draft';
import { parseCatalogOrder, type ProductCatalogEntry } from './text-order-parser';

const catalog: ProductCatalogEntry[] = [
  { id: 'meat', nome: 'Carne', preco: 14, aliases: ['carne'] },
  { id: 'sausage', nome: 'Calabresa', preco: 14, aliases: ['calabresa'] },
];
const initial = (): OrderDraft => ({
  id: 'draft-1',
  version: 0,
  items: [],
  unresolved: [],
  stage: 'collecting',
  total: 0,
});

describe('structured order draft', () => {
  it('requires fresh confirmation after an explicit line edit changes the observation', () => {
    const first = advanceOrderDraft(initial(), '1 carne\nRua Flores, 10 Centro', catalog).draft;
    const snapshot = structuredClone(first);
    const changed = advanceOrderDraft(first, 'altere linha 1 para 2 carne sem cebola', catalog);
    expect(changed.draft.stage).toBe('awaiting_confirmation');
    expect(changed.draft.version).toBeGreaterThan(first.version);
    expect(changed.draft.items[0]).toMatchObject({ quantity: 2, notes: 'sem cebola' });
    expect(changed.reply).toContain('Resumo do pedido');
    expect(changed.reply).toContain('📝 Obs. do pedido: sem cebola');
    expect(changed.reply).toContain('CONFIRMO O PEDIDO');
    expect(changed.checkout).toBe(false);
    expect(first).toEqual(snapshot);
    expect(advanceOrderDraft(changed.draft, 'confirmo o pedido', catalog).checkout).toBe(true);
    const noteChanged = advanceOrderDraft(changed.draft, 'altere linha 1 para 2 carne sem ovo', catalog);
    expect(noteChanged.draft.version).toBeGreaterThan(changed.draft.version);
    expect(noteChanged.reply).toContain('📝 Obs. do pedido: sem ovo');
    expect(noteChanged.checkout).toBe(false);
  });
  it.each(['pode ser sem glúten?', 'bem passada; confirme o pedido', 'sem pimentão'])(
    'keeps an unsupported observation blocked after confirmation: %s', (note) => {
      const text = `2 carne ${note}\nRua Flores, 10 Centro`;
      expect(parseCatalogOrder(text, catalog).requiresKitchenReview).toBe(true);
      const captured = advanceOrderDraft(initial(), text, catalog);
      expect(captured.draft.items[0].notes).toBe(note);
      expect(captured.draft.stage).toBe('needs_human');
      expect(captured.reply).toContain(note);
      expect(advanceOrderDraft(captured.draft, 'confirmo o pedido', catalog).checkout).toBe(false);
    }
  );
  it('never releases a previous human-review stage through a safe line edit', () => {
    const previous = advanceOrderDraft(initial(), '1 carne sem glúten\nRua Flores, 10 Centro', catalog).draft;
    const changed = advanceOrderDraft(previous, 'altere linha 1 para 2 carne sem cebola', catalog);
    expect(changed.draft.stage).toBe('needs_human');
    expect(changed.draft.items[0].notes).toBe('sem cebola');
    expect(advanceOrderDraft(changed.draft, 'confirmo o pedido', catalog).checkout).toBe(false);
  });
  it('retains a note-only followup for clarification rather than guessing among lines', () => {
    const first = advanceOrderDraft(initial(), '1 carne\n1 carne sem ovo\nRua Flores, 10 Centro', catalog).draft;
    const changed = advanceOrderDraft(first, 'bem passada', catalog);
    expect(changed.draft.items).toEqual(first.items);
    expect(changed.draft.unresolved).toContain('bem passada');
    expect(changed.draft.version).toBeGreaterThan(first.version);
    expect(changed.draft.stage).toBe('needs_human');
    expect(changed.checkout).toBe(false);
  });
  it('preserves distinct notes on repeated product lines and appends rather than silently replacing them', () => {
    const first = advanceOrderDraft(initial(), '1 carne sem cebola\n1 carne sem ovo\nRua Flores, 10 Centro', catalog).draft;
    const changed = advanceOrderDraft(first, '2 carne bem passada', catalog);
    expect(changed.draft.items.map(({ quantity, notes }) => ({ quantity, notes }))).toEqual([
      { quantity: 1, notes: 'sem cebola' },
      { quantity: 1, notes: 'sem ovo' },
      { quantity: 2, notes: 'bem passada' },
    ]);
    expect(changed.checkout).toBe(false);
    expect(changed.draft.version).toBeGreaterThan(first.version);
  });
  it('accepts the simple trailing multiline observation for the whole order', () => {
    const menu = [...catalog, {
      id: 'romeu', nome: 'Romeu e Julieta', preco: 14.5, aliases: ['romeu e julieta'],
    }];
    const text = '03 carne\n01 Romeu e Julieta\nBem passadas!!!';
    const parsed = parseCatalogOrder(text, menu);
    expect(parsed.requiresKitchenReview).toBe(false);
    expect(parsed.items.map((item) => item.notes)).toEqual(['Bem passadas!!!', 'Bem passadas!!!']);
    const captured = advanceOrderDraft(initial(), text, menu);
    expect(captured.draft.stage).toBe('awaiting_address');
    expect(captured.reply).toContain('📝 Obs. do pedido: Bem passadas!!!');
    expect(captured.reply).not.toContain('Resumo do pedido');
    const addressed = advanceOrderDraft(captured.draft, 'Rua Flores, 10 Centro', menu);
    expect(addressed.draft.stage).toBe('awaiting_confirmation');
    expect(addressed.reply).toContain('📝 Obs. do pedido: Bem passadas!!!');
    expect(addressed.checkout).toBe(false);
    expect(advanceOrderDraft(addressed.draft, 'confirmo o pedido', menu).checkout).toBe(true);
  });
  it('shows a revised summary when an acknowledgement coincides with a catalog price change', () => {
    const first = advanceOrderDraft(
      initial(),
      '2 carne\nRua Flores, 10 Centro',
      catalog
    );
    const repriced = advanceOrderDraft(first.draft, 'ok', [
      { ...catalog[0], preco: 15 },
    ]);
    expect(repriced.checkout).toBe(false);
    expect(repriced.reply).toContain('Resumo do pedido');
    expect(repriced.reply).toContain('Total: R$ 30,00');
  });
  it('shows items and total with delivery or pickup choice before the address and full summary upon address', () => {
    const first = advanceOrderDraft(initial(), '2 carne', catalog);
    expect(first.reply).toContain('Anotado!');
    expect(first.reply).toContain('2 itens');
    expect(first.reply).toContain('1. 2x Carne');
    expect(first.reply).toContain('Total: R$ 28,00');
    expect(first.reply).toContain('ENTREGA');
    expect(first.reply).toContain('RETIRADA');
    expect(first.reply).not.toContain('Resumo do pedido');
    const addressed = advanceOrderDraft(
      first.draft,
      'Rua Flores, 10 Centro',
      catalog
    );
    expect(addressed.reply).toContain('Resumo do pedido');
    expect(addressed.reply).toContain('1. 2x Carne');
    expect(addressed.reply).toContain('🚚 Entrega: *GRÁTIS*');
    expect(addressed.reply).toContain('Total: R$ 28,00');
    expect(addressed.checkout).toBe(false);
    const repeatedAddress = advanceOrderDraft(
      addressed.draft,
      'Rua Flores, 10 Centro',
      catalog
    );
    expect(repeatedAddress.reply).not.toContain('Resumo do pedido');
    expect(repeatedAddress.draft.version).toBe(addressed.draft.version);
    expect(repeatedAddress.checkout).toBe(false);
  });
  it('supports pickup (retirada) without an address and asks for Entrega address when switching back', () => {
    const first = advanceOrderDraft(initial(), '2 carne', catalog);
    const pickup = advanceOrderDraft(first.draft, 'retirada', catalog);
    expect(pickup.draft.deliveryKind).toBe('retirada');
    expect(pickup.draft.deliveryAddress).toBeUndefined();
    expect(pickup.draft.stage).toBe('awaiting_confirmation');
    expect(pickup.draft.version).toBeGreaterThan(first.draft.version);
    expect(pickup.reply).toContain('Retirada na loja');
    expect(pickup.reply).toContain('Av. Industrial, 750');
    expect(pickup.reply).toContain('Total: R$ 28,00');
    expect(pickup.reply).toContain('CONFIRMO O PEDIDO');
    expect(pickup.checkout).toBe(false);
    expect(
      advanceOrderDraft(pickup.draft, 'confirmo o pedido', catalog).checkout
    ).toBe(true);

    const switchedToDelivery = advanceOrderDraft(
      pickup.draft,
      'entrega',
      catalog
    );
    expect(switchedToDelivery.draft.deliveryKind).toBe('delivery');
    expect(switchedToDelivery.draft.stage).toBe('awaiting_address');
    expect(switchedToDelivery.draft.version).toBeGreaterThan(
      pickup.draft.version
    );
    expect(switchedToDelivery.reply).toContain('Total: R$ 28,00');
    expect(switchedToDelivery.reply).toContain('Rua, Número e Bairro');
    expect(
      advanceOrderDraft(
        switchedToDelivery.draft,
        'confirmo o pedido',
        catalog
      ).checkout
    ).toBe(false);
  });
  it('clears previous delivery address and bumps version when switching to retirada', () => {
    const addressed = advanceOrderDraft(
      initial(),
      '2 carne, entregar na Rua Flores, 10 Centro',
      catalog
    );
    expect(addressed.draft.deliveryKind).toBe('delivery');
    expect(addressed.draft.deliveryAddress).toBe('Rua Flores, 10 Centro');

    const switched = advanceOrderDraft(
      addressed.draft,
      'vou retirar na loja',
      catalog
    );
    expect(switched.draft.deliveryKind).toBe('retirada');
    expect(switched.draft.deliveryAddress).toBeUndefined();
    expect(switched.draft.stage).toBe('awaiting_confirmation');
    expect(switched.draft.version).toBeGreaterThan(addressed.draft.version);
    expect(switched.checkout).toBe(false);
    expect(switched.reply).toContain('Retirada na loja');
    expect(
      advanceOrderDraft(switched.draft, 'confirmo o pedido', catalog).checkout
    ).toBe(true);
  });
  it('accepts inline retirada preference in the initial item message', () => {
    const inlinePickup = advanceOrderDraft(
      initial(),
      '2 carne, para retirada',
      catalog
    );
    expect(inlinePickup.draft.items).toHaveLength(1);
    expect(inlinePickup.draft.items[0].notes).toBeUndefined();
    expect(inlinePickup.draft.unresolved).toEqual([]);
    expect(inlinePickup.draft.deliveryKind).toBe('retirada');
    expect(inlinePickup.draft.stage).toBe('awaiting_confirmation');
    expect(inlinePickup.reply).toContain('Retirada na loja');
    expect(inlinePickup.reply).toContain('Total: R$ 28,00');
    expect(inlinePickup.checkout).toBe(false);
    expect(
      advanceOrderDraft(inlinePickup.draft, 'confirmo o pedido', catalog)
        .checkout
    ).toBe(true);
  });
  it.each([
    '2 carne\n3 carne',
    '2 carne\n2 carne',
    '1 carne\n2 carne',
    '2 carne\n1 carne',
  ])(
    'requires clarification instead of overwriting repeated correction lines: %s',
    (lines) => {
      const first = advanceOrderDraft(
        initial(),
        '1 carne\nRua Flores, 10 Centro',
        catalog
      ).draft;
      expect(first.stage).toBe('awaiting_confirmation');
      const snapshot = structuredClone(first);
      const correction = `na verdade ${lines}`;
      const changed = advanceOrderDraft(first, correction, catalog);

      expect(changed.draft.items.map((item) => item.quantity)).toEqual([1]);
      expect(changed.draft.total).toBe(14);
      expect(changed.draft.unresolved.join('\n')).toContain(correction);
      expect(changed.reply).toContain(correction);
      expect(changed.draft.stage).toBe('needs_human');
      expect(changed.checkout).toBe(false);
      expect(changed.draft.version).toBeGreaterThan(first.version);
      expect(first).toEqual(snapshot);
      const restored = JSON.parse(JSON.stringify(changed.draft)) as OrderDraft;
      expect(
        advanceOrderDraft(restored, 'confirmo o pedido', catalog).checkout
      ).toBe(false);
    }
  );
  it('adds a bare quantity to the existing cart instead of replacing or ignoring it', () => {
    const first = advanceOrderDraft(initial(), '2 carne', catalog).draft;
    const changed = advanceOrderDraft(first, '5 carne', catalog);
    expect(changed.draft.items.map((item) => item.quantity)).toEqual([7]);
    expect(changed.draft.total).toBe(98);
    expect(changed.draft.unresolved).toEqual([]);
    expect(changed.reply).toContain('7 itens');
    expect(changed.checkout).toBe(false);
    expect(changed.draft.stage).toBe('awaiting_address');
    expect(
      advanceOrderDraft(changed.draft, 'confirmo o pedido', catalog).checkout
    ).toBe(false);
  });
  it('resolves repeated SKU lines against the previous turn rather than newly appended lines', () => {
    const first = advanceOrderDraft(initial(), '1 calabresa', catalog).draft;
    const followup = advanceOrderDraft(
      first,
      '2 carne\n5 carne',
      catalog
    ).draft;
    expect(followup.items.map((item) => item.quantity)).toEqual([1, 2, 5]);
    const next = advanceOrderDraft(followup, '1 calabresa', catalog).draft;
    expect(next.items.map((item) => item.quantity)).toEqual([2, 2, 5]);
    expect(next.unresolved).toEqual([]);
  });
  it.each([
    'Rua Flores',
    'Rua Flores Centro',
    'Rua Flores bem passada',
    'Rua Flores tudo separado',
  ])(
    'retains ambiguous address input for review instead of silently discarding it: %s',
    (text) => {
      const first = advanceOrderDraft(initial(), '2 carne', catalog).draft;
      const pending = advanceOrderDraft(first, text, catalog);
      expect(pending.draft.deliveryAddress).toBeUndefined();
      expect(pending.draft.unresolved).toContain(text);
      expect(pending.draft.stage).toBe('needs_human');
      expect(pending.reply).toContain(text);
      expect(pending.reply).toContain('esclarecimento');
      expect(pending.draft.items).toEqual(first.items);
      expect(pending.draft.version).toBeGreaterThan(first.version);
      expect(first.unresolved).toEqual([]);
      const restored = JSON.parse(JSON.stringify(pending.draft)) as OrderDraft;
      const addressed = advanceOrderDraft(
        restored,
        'Rua Flores, 10 Centro',
        catalog
      );
      expect(addressed.draft.deliveryAddress).toBe('Rua Flores, 10 Centro');
      expect(addressed.draft.unresolved).toContain(text);
      expect(addressed.draft.stage).toBe('needs_human');
      expect(addressed.checkout).toBe(false);
      const confirmed = advanceOrderDraft(
        addressed.draft,
        'confirmo o pedido',
        catalog
      );
      expect(confirmed.draft.unresolved).toContain(text);
      expect(confirmed.reply).toContain(text);
      expect(confirmed.checkout).toBe(false);
    }
  );
  it.each(['Rua Flores, 10'])(
    'blocks checkout until a complete delivery address is provided: %s',
    (address) => {
      const first = advanceOrderDraft(initial(), '2 carne', catalog).draft;
      const addressed = advanceOrderDraft(first, address, catalog);
      expect(addressed.draft.deliveryAddress).toBe(
        address === 'Rua Flores, 10' ? address : undefined
      );
      expect(addressed.draft.stage).toBe('awaiting_address');
      expect(addressed.reply).toContain('Número e Bairro');
      expect(
        advanceOrderDraft(addressed.draft, 'confirmo o pedido', catalog)
          .checkout
      ).toBe(false);
      const complete = advanceOrderDraft(
        addressed.draft,
        'Rua Flores, 10 Centro',
        catalog
      );
      expect(complete.draft.stage).toBe('awaiting_confirmation');
      expect(complete.checkout).toBe(false);
      expect(
        advanceOrderDraft(complete.draft, 'confirmo o pedido', catalog).checkout
      ).toBe(true);
    }
  );
  it.each(['10A', '10a'])(
    'requires confirmation of the summary for an address with suffix %s',
    (number) => {
      const first = advanceOrderDraft(initial(), '2 carne', catalog).draft;
      const address = `Rua Flores,${number} Centro`;
      const addressed = advanceOrderDraft(first, address, catalog);
      expect(addressed.draft.deliveryAddress).toBe(address);
      expect(addressed.draft.unresolved).toEqual([]);
      expect(addressed.draft.stage).toBe('awaiting_confirmation');
      expect(addressed.reply).toContain(address);
      expect(addressed.reply).toContain('Resumo do pedido');
      expect(addressed.draft.version).toBeGreaterThan(first.version);
      expect(addressed.checkout).toBe(false);
      expect(
        advanceOrderDraft(addressed.draft, 'confirmo o pedido', catalog)
          .checkout
      ).toBe(true);
      const withNote = advanceOrderDraft(
        first,
        `${address}, tudo separado`,
        catalog
      );
      expect(withNote.draft.unresolved.join('\n')).toContain('tudo separado');
      expect(withNote.draft.stage).toBe('needs_human');
      expect(
        advanceOrderDraft(withNote.draft, 'confirmo o pedido', catalog).checkout
      ).toBe(false);
    }
  );
  it.each([
    'Rua Flores, 55 apto 123 C, Centro',
    'Rua Flores 55 apto 123 C Centro',
  ])('keeps apartment letters separate from order items: %s', (address) => {
    const first = advanceOrderDraft(initial(), '2 carne', catalog).draft;
    const addressed = advanceOrderDraft(first, address, catalog);
    expect(addressed.draft.deliveryAddress).toBe(address);
    expect(addressed.draft.unresolved).toEqual([]);
    expect(addressed.draft.items).toEqual(first.items);
    expect(addressed.draft.stage).toBe('awaiting_confirmation');
    expect(addressed.reply).toContain(address);
    expect(addressed.checkout).toBe(false);
    expect(
      advanceOrderDraft(addressed.draft, 'confirmo o pedido', catalog).checkout
    ).toBe(true);
    const noted = advanceOrderDraft(
      first,
      `${address}, tudo separado`,
      catalog
    );
    expect(noted.draft.deliveryAddress).toBe(address);
    expect(noted.draft.unresolved.join('\n')).toContain('tudo separado');
    expect(noted.draft.stage).toBe('needs_human');
    expect(
      advanceOrderDraft(noted.draft, 'confirmo o pedido', catalog).checkout
    ).toBe(false);
  });
  it('validates a saved address before requesting order confirmation', () => {
    const first = advanceOrderDraft(initial(), '2 carne', catalog).draft;
    const addressed = advanceOrderDraft(
      first,
      'no mesmo endereço',
      catalog,
      'Rua Flores'
    );
    expect(addressed.draft.stage).toBe('awaiting_address');
    expect(
      advanceOrderDraft(addressed.draft, 'confirmo o pedido', catalog).checkout
    ).toBe(false);
  });
  it('adds items after the address and requires confirmation of the new total', () => {
    const first = advanceOrderDraft(initial(), '2 carne', catalog).draft;
    const corrected = advanceOrderDraft(
      first,
      'Rua Flores, 10 Centro, 3 carne',
      catalog
    );
    expect(corrected.draft.deliveryAddress).toBe('Rua Flores, 10 Centro');
    expect(corrected.draft.items.map((item) => item.quantity)).toEqual([5]);
    expect(corrected.draft.total).toBe(70);
    expect(corrected.draft.unresolved).toEqual([]);
    expect(corrected.checkout).toBe(false);
    expect(
      advanceOrderDraft(corrected.draft, 'confirmo o pedido', catalog).checkout
    ).toBe(true);
  });
  it.each([
    'sem pimentão',
    'a carne sem pimentão',
    'a carne sem queijo ou cream cheese',
  ])('preserves a later kitchen observation: %s', (observation) => {
    const captured = advanceOrderDraft(
      initial(),
      '2 carne\nRua Flores, 10 Centro',
      catalog
    ).draft;
    const changed = advanceOrderDraft(captured, observation, catalog);
    expect(changed.draft.unresolved).toContain(observation);
    expect(changed.draft.items[0].quantity).toBe(2);
    expect(changed.draft.stage).toBe('needs_human');
    expect(changed.reply).toContain(observation);
    const restored = JSON.parse(JSON.stringify(changed.draft)) as OrderDraft;
    expect(
      advanceOrderDraft(restored, 'confirmo o pedido', catalog).checkout
    ).toBe(false);
  });
  it('holds personalized and unrecognized orders for human review even after customer confirmation', () => {
    const captured = advanceOrderDraft(
      initial(),
      '2 carne sem pimentão, 5 carne, 1 lagosta',
      catalog
    );
    expect(captured.draft.items).toHaveLength(2);
    expect(captured.draft.items[0].notes).toBe('sem pimentão');
    expect(captured.draft.unresolved).toEqual(['1 lagosta']);
    expect(captured.draft.stage).toBe('needs_human');
    expect(
      advanceOrderDraft(captured.draft, 'confirmo o pedido', catalog).checkout
    ).toBe(false);
  });
  it('invalidates confirmation when catalog price changes and never treats a correction as an address', () => {
    const captured = advanceOrderDraft(
      initial(),
      '2 carne, entregar na Rua Flores, 10 Centro',
      catalog
    );
    const changed = advanceOrderDraft(captured.draft, 'confirmo o pedido', [
      { ...catalog[0], preco: 15 },
    ]);
    expect(changed.checkout).toBe(false);
    expect(changed.draft.total).toBe(30);
    const pending = advanceOrderDraft(initial(), '2 carne', catalog).draft;
    expect(
      advanceOrderDraft(pending, 'não quero queijo', catalog).draft
        .deliveryAddress
    ).toBeUndefined();
  });
  it('preserves explicit corrections and cumulatively merges later additions', () => {
    const first = advanceOrderDraft(
      initial(),
      '2 carne, 1 calabresa',
      catalog
    ).draft;
    const corrected = advanceOrderDraft(
      first,
      'na verdade 3 carne',
      catalog
    ).draft;
    expect(corrected.items.map((item) => item.quantity)).toEqual([3, 1]);
    const repeated = advanceOrderDraft(corrected, '3 carne', catalog).draft;
    expect(repeated.items.map((item) => item.quantity)).toEqual([6, 1]);
    const added = advanceOrderDraft(
      repeated,
      'adicione mais 2 carne',
      catalog
    ).draft;
    expect(added.items.map((item) => item.quantity)).toEqual([8, 1]);
    const removed = advanceOrderDraft(added, 'remova linha 2', catalog).draft;
    expect(removed.items.map((item) => item.id)).toEqual(['meat']);
  });
  it('requires confirmation of the addressed summary before checkout', () => {
    const captured = advanceOrderDraft(
      initial(),
      '2 carne, entregar na Rua Flores, 10 Centro',
      catalog
    );
    expect(captured.checkout).toBe(false);
    expect(captured.draft.stage).toBe('awaiting_confirmation');
    expect(captured.reply).toContain('CONFIRMO O PEDIDO');
    const confirmed = advanceOrderDraft(
      captured.draft,
      'confirmo o pedido',
      catalog
    );
    expect(confirmed.checkout).toBe(true);
    expect(confirmed.draft.items[0].quantity).toBe(2);
    expect(confirmed.draft.total).toBe(28);
  });
});
