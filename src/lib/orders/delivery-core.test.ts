import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import cardapio from '../../../assets/js/cardapio.json';
import { catalogEntries } from './order-catalog';
import { parseCatalogOrder } from './text-order-parser';

const skillPath = '.hermes/skills/delivery-core.md';

describe('permanent delivery project rules', () => {
  it('requires every project agent to read the delivery rules before edits', () => {
    const instructions = readFileSync('AGENTS.md', 'utf8');
    expect(instructions).toContain(skillPath);
    expect(instructions).toContain('antes de qualquer alteração');
    expect(instructions).toContain('BEGIN:nextjs-agent-rules');
  });

  it('keeps the project skill in versionable source rather than a local profile', () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it.each(cardapio.itens)(
    'documents the exact official price and ID: $nome',
    (item) => {
      expect(existsSync(skillPath)).toBe(true);
      const skill = readFileSync(skillPath, 'utf8');
      expect(skill).toContain(
        `| ${item.id} | ${item.nome} | R$ ${item.preco.toFixed(2).replace('.', ',')} |`
      );
    }
  );

  it('documents free delivery, three channels, priority and payment safeguards', () => {
    expect(existsSync(skillPath)).toBe(true);
    const skill = readFileSync(skillPath, 'utf8');
    for (const required of [
      'Frete Grátis = R$ 0,00',
      'Site',
      'Catálogo Meta',
      'Texto Livre 50+',
      '+ 1 empanada frango',
      'Intenção de pedido sempre tem prioridade sobre pausas de atendente',
      '[TOTAL:xxx.xx]',
      '042_order_intent_priority.sql',
      '.env.local',
    ])
      expect(skill).toContain(required);
  });

  it('keeps the 045 seed aligned with all 26 official items and prices', () => {
    const seedPath = 'supabase/migrations/045_seed_official_menu_items.sql';
    expect(existsSync(seedPath)).toBe(true);
    const seedSql = readFileSync(seedPath, 'utf8');
    for (const item of cardapio.itens) {
      expect(seedSql).toContain(`'${item.nome}'`);
      expect(seedSql).toContain(`${item.preco.toFixed(2)}::numeric(10,2)`);
    }
    const entries = catalogEntries(
      cardapio.itens.map((item) => ({
        id: item.id,
        name: item.nome,
        price: item.preco,
        is_available: true,
      }))
    );
    expect(entries).toHaveLength(cardapio.itens.length);
    const carneOrder = parseCatalogOrder('2 carne', entries);
    expect(carneOrder.unresolved).toEqual([]);
    expect(carneOrder.items).toEqual([
      expect.objectContaining({
        id: 'emp_hamburguer',
        title: 'Empanada de Carne com Ovos',
        quantity: 2,
        unitPrice: 14,
        totalPrice: 28,
      }),
    ]);
  });
});
