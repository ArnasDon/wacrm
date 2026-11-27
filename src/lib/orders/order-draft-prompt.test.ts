import { describe, expect, it } from 'vitest';
import { advanceOrderDraft, type OrderDraft } from './order-draft';

const catalog = [
  { id: 'meat', nome: 'Empanada de Carne', preco: 14, aliases: ['carne'] },
];
const empty = (): OrderDraft => ({
  id: 'draft',
  version: 0,
  stage: 'collecting',
  total: 0,
  items: [],
  unresolved: [],
});
const prompt = 'Quer adicionar mais algo (bebida, sobremesa)?';

describe('closing prompt wording without a new stage', () => {
  it('shows items, total and delivery/pickup choice while awaiting the address', () => {
    const result = advanceOrderDraft(empty(), '2 carne', catalog);
    expect(result.reply).toContain(prompt);
    expect(result.reply).toContain('Total: R$ 28,00');
    expect(result.reply).toContain('ENTREGA');
    expect(result.reply).toContain('RETIRADA');
    expect(result.reply).not.toContain(
      'Gostaria de adicionar mais alguma coisa'
    );
    expect(result.reply).toContain('endereço completo');
    expect(result.draft.stage).toBe('awaiting_address');
    expect(result.draft.items).toHaveLength(1);
    expect(result.draft.total).toBe(28);
    expect(result.checkout).toBe(false);
  });

  it('does not add an upsell step to a complete addressed order', () => {
    const result = advanceOrderDraft(
      empty(),
      '2 carne\nRua Flores, 10 Centro',
      catalog
    );
    expect(result.reply).not.toContain(prompt);
    expect(result.draft.stage).toBe('awaiting_confirmation');
    expect(result.checkout).toBe(false);
    expect(result.reply).toContain('CONFIRMO O PEDIDO');
  });

  it('does not turn closing small talk into consent or add products', () => {
    const first = advanceOrderDraft(empty(), '2 carne', catalog).draft;
    const result = advanceOrderDraft(first, 'pode fechar', catalog);
    expect(result.draft.items).toEqual(first.items);
    expect(result.draft.total).toBe(first.total);
    expect(result.draft.stage).toBe('awaiting_address');
    expect(result.checkout).toBe(false);
  });

  it('does not offer additions to an ambiguous order under review', () => {
    const result = advanceOrderDraft(empty(), '2 carne sem glúten', catalog);
    expect(result.reply).not.toContain(prompt);
    expect(result.draft.stage).toBe('needs_human');
    expect(result.checkout).toBe(false);
  });
});
