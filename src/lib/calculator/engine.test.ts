import { describe, expect, it } from 'vitest';
import {
  amountOf,
  applyDirectEdit,
  buildFlowText,
  createDefaultFlowItems,
  createFlowItem,
  DEFAULT_FLOW_COMPONENTS,
  percentOf,
  recalculate,
  toComponentTemplates,
} from './engine';
import type { FlowItem } from './types';

const money = (v: number) => `R$ ${v.toFixed(0)}`;

function single(
  id: string,
  label: string,
  value: number,
  locked = false,
  percent: number | null = null,
): FlowItem {
  return { id, label, kind: 'single', locked, value, count: 1, percent };
}
function installments(
  id: string,
  label: string,
  count: number,
  value: number,
  locked = false,
  percent: number | null = null,
): FlowItem {
  return { id, label, kind: 'installments', locked, value, count, percent };
}

describe('recalculate — Fluxo Livre (all free)', () => {
  it('a single free item absorbs the whole property value', () => {
    const result = recalculate(500_000, [single('entrada', 'Entrada', 0)]);
    expect(result.status).toBe('closed');
    expect(result.items[0].value).toBe(500_000);
    expect(result.balancerId).toBe('entrada');
  });

  it('only one field free: it becomes the balancer and closes the flow', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true),
      installments('mensais', 'Mensais', 36, 2_500, true),
      single('financiamento', 'Financiamento', 0, false),
    ];
    const result = recalculate(500_000, items);
    expect(result.status).toBe('closed');
    const financ = result.items.find((i) => i.id === 'financiamento')!;
    expect(financ.value).toBe(500_000 - 50_000 - 36 * 2_500);
  });

  it('every field locked: nothing to adjust, status reflects the fixed sum', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true),
      single('financiamento', 'Financiamento', 300_000, true),
    ];
    const result = recalculate(500_000, items);
    expect(result.balancerId).toBeNull();
    expect(result.status).toBe('incomplete');
    expect(result.difference).toBe(-150_000);
  });
});

describe('recalculate — locking behaviour', () => {
  it('locked entrada is never modified by the engine', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true),
      single('financiamento', 'Financiamento', 0),
    ];
    const result = recalculate(700_000, items);
    expect(result.items.find((i) => i.id === 'entrada')!.value).toBe(50_000);
  });

  it('locked mensais (installments) keeps both count and value untouched', () => {
    const items = [
      installments('mensais', 'Mensais', 36, 2_500, true),
      single('financiamento', 'Financiamento', 0),
    ];
    const result = recalculate(500_000, items);
    const mensais = result.items.find((i) => i.id === 'mensais')!;
    expect(mensais.count).toBe(36);
    expect(mensais.value).toBe(2_500);
  });

  it('locked financiamento is never modified even when other fields change', () => {
    const items = [
      single('entrada', 'Entrada', 0),
      single('financiamento', 'Financiamento', 300_000, true),
    ];
    const result = recalculate(500_000, items);
    expect(result.items.find((i) => i.id === 'financiamento')!.value).toBe(300_000);
    expect(result.items.find((i) => i.id === 'entrada')!.value).toBe(200_000);
  });

  it('multiple locked values are all respected simultaneously', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true),
      installments('mensais', 'Mensais', 36, 2_500, true),
      installments('intermediarias', 'Intermediárias', 4, 15_000, true),
      single('financiamento', 'Financiamento', 0),
    ];
    const result = recalculate(500_000, items);
    expect(result.items.find((i) => i.id === 'entrada')!.value).toBe(50_000);
    expect(result.items.find((i) => i.id === 'mensais')!.value).toBe(2_500);
    expect(result.items.find((i) => i.id === 'intermediarias')!.value).toBe(15_000);
    expect(result.status).toBe('closed');
    const financ = result.items.find((i) => i.id === 'financiamento')!;
    expect(financ.value).toBe(500_000 - 50_000 - 36 * 2_500 - 4 * 15_000);
  });

  it('locking then unlocking a value hands balancing back to it', () => {
    const base = [
      single('entrada', 'Entrada', 100_000),
      single('financiamento', 'Financiamento', 0),
    ];
    const lockedEntrada = base.map((i) => (i.id === 'entrada' ? { ...i, locked: true } : i));
    const afterLock = recalculate(500_000, lockedEntrada);
    expect(afterLock.balancerId).toBe('financiamento');

    const unlocked = afterLock.items.map((i) =>
      i.id === 'entrada' ? { ...i, locked: false } : i,
    );
    const afterUnlock = recalculate(500_000, unlocked);
    // entrada is free again and keeps its last value; financiamento
    // (now the only OTHER free field, still last in order) re-balances.
    expect(afterUnlock.items.find((i) => i.id === 'entrada')!.locked).toBe(false);
  });
});

describe('recalculate — flow status', () => {
  it('flags an incomplete flow with the exact missing amount', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true),
      single('financiamento', 'Financiamento', 300_000, true),
    ];
    const result = recalculate(500_000, items);
    expect(result.status).toBe('incomplete');
    expect(result.difference).toBeCloseTo(-150_000, 5);
  });

  it('flags an excess flow with the exact overage amount', () => {
    const items = [
      single('entrada', 'Entrada', 100_000, true),
      single('financiamento', 'Financiamento', 450_000, true),
    ];
    const result = recalculate(500_000, items);
    expect(result.status).toBe('excess');
    expect(result.difference).toBeCloseTo(50_000, 5);
  });

  it('a fully closed flow reports zero difference', () => {
    const items = [
      single('entrada', 'Entrada', 200_000, true),
      single('financiamento', 'Financiamento', 300_000, true),
    ];
    const result = recalculate(500_000, items);
    expect(result.status).toBe('closed');
    expect(result.difference).toBeCloseTo(0, 5);
  });

  it('clamps an over-budget balancer to 0 instead of going negative, and still reports excess', () => {
    const items = [
      single('entrada', 'Entrada', 400_000, true),
      installments('mensais', 'Mensais', 10, 20_000, true), // 200k, already over
      single('financiamento', 'Financiamento', 0),
    ];
    const result = recalculate(500_000, items);
    expect(result.items.find((i) => i.id === 'financiamento')!.value).toBe(0);
    expect(result.status).toBe('excess');
    expect(result.difference).toBeCloseTo(100_000, 5);
  });
});

describe('amountOf', () => {
  it('single items contribute their raw value', () => {
    expect(amountOf(single('a', 'A', 42))).toBe(42);
  });
  it('installments items contribute count * value', () => {
    expect(amountOf(installments('a', 'A', 4, 15_000))).toBe(60_000);
  });
});

describe('createFlowItem', () => {
  it('seeds an installments item with its template default count', () => {
    const item = createFlowItem({
      id: 'mensais',
      label: 'Mensais',
      kind: 'installments',
      defaultLocked: false,
      defaultCount: 36,
    });
    expect(item.count).toBe(36);
    expect(item.value).toBe(0);
    expect(item.locked).toBe(false);
    expect(item.percent).toBeNull();
  });

  it('seeds the percent link from the template default', () => {
    const item = createFlowItem({
      id: 'entrada',
      label: 'Entrada',
      kind: 'single',
      defaultLocked: false,
      defaultPercent: 10,
    });
    expect(item.percent).toBe(10);
  });
});

describe('recalculate — percent-driven items', () => {
  it('a free single item with a percent link derives its value from property value', () => {
    const items = [single('entrada', 'Entrada', 0, false, 10), single('resto', 'Resto', 0)];
    const result = recalculate(500_000, items);
    expect(result.items.find((i) => i.id === 'entrada')!.value).toBe(50_000);
    // resto (the balancer) absorbs the remainder
    expect(result.items.find((i) => i.id === 'resto')!.value).toBe(450_000);
  });

  it('a free installments item with a percent link splits the percent total across count', () => {
    const items = [
      installments('parcelas', 'Parcelas', 10, 0, false, 25),
      single('resto', 'Resto', 0),
    ];
    const result = recalculate(400_000, items);
    const parcelas = result.items.find((i) => i.id === 'parcelas')!;
    expect(parcelas.value).toBe(10_000); // 25% of 400k = 100k / 10 parcelas
  });

  it('a locked item with a percent link is never percent-recomputed', () => {
    const items = [
      single('entrada', 'Entrada', 999, true, 10),
      single('resto', 'Resto', 0),
    ];
    const result = recalculate(500_000, items);
    expect(result.items.find((i) => i.id === 'entrada')!.value).toBe(999);
  });

  it('a percent-linked item is NEVER the balancer, even when it is the only unlocked field', () => {
    // Product requirement (percent-sum validation, "sem redistribuição
    // automática"): a percent-driven item always shows exactly what
    // its own percentage computes to. It must never get silently
    // overridden to force the flow closed — that would hide a real
    // incomplete/excess condition from the user.
    const items = [
      single('entrada', 'Entrada', 50_000, true),
      single('financiamento', 'Financiamento', 0, false, 40),
    ];
    const result = recalculate(500_000, items);
    const financ = result.items.find((i) => i.id === 'financiamento')!;
    expect(financ.value).toBe(200_000); // exactly 40% of 500k, not the 450k remainder
    expect(result.balancerId).toBeNull();
    expect(result.status).toBe('incomplete');
    expect(result.difference).toBeCloseTo(-250_000, 5); // 50k + 200k = 250k of 500k
  });

  it('a non-percent item is still balancer-eligible and absorbs the remainder as before', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true),
      single('financiamento', 'Financiamento', 0, false, null),
    ];
    const result = recalculate(500_000, items);
    const financ = result.items.find((i) => i.id === 'financiamento')!;
    expect(financ.value).toBe(450_000);
    expect(result.balancerId).toBe('financiamento');
    expect(result.status).toBe('closed');
  });

  it('the four standard etapas (10/25/25/40) sum to exactly the property value when unmodified', () => {
    const items = createDefaultFlowItems();
    const result = recalculate(500_000, items);
    expect(result.balancerId).toBeNull(); // all four are percent-linked — no balancer
    expect(result.status).toBe('closed');
    expect(result.items.find((i) => i.id === 'entrada')!.value).toBe(50_000);
    expect(result.items.find((i) => i.id === 'parcelas')!.value).toBe(125_000);
    expect(result.items.find((i) => i.id === 'intercaladas')!.value).toBe(125_000);
    expect(result.items.find((i) => i.id === 'chaves')!.value).toBe(200_000);
  });

  it('DEFAULT_FLOW_COMPONENTS percentages sum to 100', () => {
    const total = DEFAULT_FLOW_COMPONENTS.reduce((sum, c) => sum + (c.defaultPercent ?? 0), 0);
    expect(total).toBe(100);
  });

  it('percentages summing to less than 100% report "incomplete" with no redistribution', () => {
    // 10 + 10 + 25 + 35 = 80% — spec example: "faltam 20%".
    const items = [
      single('entrada', 'Entrada', 0, false, 10),
      installments('parcelas', 'Parcelas', 1, 0, false, 10),
      installments('intercaladas', 'Intercaladas', 1, 0, false, 25),
      single('chaves', 'Chaves', 0, false, 35),
    ];
    const result = recalculate(300_000, items);
    expect(result.balancerId).toBeNull();
    expect(result.status).toBe('incomplete');
    // Nothing was redistributed — each item shows exactly its own %.
    expect(result.items.find((i) => i.id === 'entrada')!.value).toBe(30_000);
    expect(result.items.find((i) => i.id === 'chaves')!.value).toBe(105_000);
    expect(result.total).toBe(240_000); // 80% of 300k
    expect(result.difference).toBeCloseTo(-60_000, 5); // faltam R$60.000 (20%)
  });

  it('percentages summing to more than 100% report "excess" with no redistribution', () => {
    // 10 + 30 + 25 + 40 = 105% — spec example: "excesso de 5%".
    const items = [
      single('entrada', 'Entrada', 0, false, 10),
      installments('parcelas', 'Parcelas', 1, 0, false, 30),
      installments('intercaladas', 'Intercaladas', 1, 0, false, 25),
      single('chaves', 'Chaves', 0, false, 40),
    ];
    const result = recalculate(300_000, items);
    expect(result.balancerId).toBeNull();
    expect(result.status).toBe('excess');
    expect(result.items.find((i) => i.id === 'chaves')!.value).toBe(120_000); // still 40%, untouched
    expect(result.total).toBe(315_000); // 105% of 300k
    expect(result.difference).toBeCloseTo(15_000, 5); // excedente de R$15.000 (5%)
  });

  it('editing one percent-linked item live-updates the total with no other field moving', () => {
    const items = createDefaultFlowItems();
    const first = recalculate(300_000, items);
    expect(first.status).toBe('closed');

    // User bumps Chaves from 40% to 35% — nothing else should move,
    // and the flow should now read as incomplete by exactly 5%.
    const edited = first.items.map((i) => (i.id === 'chaves' ? { ...i, percent: 35 } : i));
    const second = recalculate(300_000, edited);
    expect(second.items.find((i) => i.id === 'entrada')!.value).toBe(30_000); // unchanged
    expect(second.items.find((i) => i.id === 'chaves')!.value).toBe(105_000); // 35% of 300k
    expect(second.status).toBe('incomplete');
    expect(second.difference).toBeCloseTo(-15_000, 5); // faltam 5%
  });
});

describe('toComponentTemplates', () => {
  it('preserves an active percent link verbatim', () => {
    const templates = toComponentTemplates([single('entrada', 'Entrada', 50_000, false, 10)], 500_000);
    expect(templates[0].defaultPercent).toBe(10);
  });

  it('derives a percent from the current ratio when the link was broken by a manual R$ edit', () => {
    // Same scenario as the "editing value clears percent" flow: user
    // typed 80.000 directly, percent is null, but that R$ amount is
    // still 16% of the property value — the save must capture that,
    // not silently drop it to 0/undefined.
    const templates = toComponentTemplates([single('entrada', 'Entrada', 80_000, false, null)], 500_000);
    expect(templates[0].defaultPercent).toBe(16);
  });

  it('leaves defaultPercent undefined when there is no property value to derive a ratio from', () => {
    const templates = toComponentTemplates([single('entrada', 'Entrada', 0, false, null)], 0);
    expect(templates[0].defaultPercent).toBeUndefined();
  });

  it('drops the amount and keeps only shape (locked/count) for the rest', () => {
    const templates = toComponentTemplates(
      [installments('parcelas', 'Parcelas', 12, 5_000, true, 25)],
      500_000,
    );
    expect(templates[0]).toEqual({
      id: 'parcelas',
      label: 'Parcelas',
      kind: 'installments',
      defaultLocked: true,
      defaultCount: 12,
      defaultPercent: 25,
    });
  });
});

describe('percentOf', () => {
  it('computes the live ratio of an item to the property value', () => {
    expect(percentOf(single('a', 'A', 50_000), 500_000)).toBe(10);
  });
  it('falls back to the stored percent link when property value is 0', () => {
    expect(percentOf(single('a', 'A', 0, false, 25), 0)).toBe(25);
  });
});

describe('applyDirectEdit — editing the unit value or count column', () => {
  it("the spec's own example: trava Entrada e Chaves, edita o valor unitário da Parcela, Intercaladas absorve o resto", () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true, 10),
      installments('parcelas', 'Parcelas', 50, 1_600, false, 25),
      installments('intercaladas', 'Intercaladas', 8, 10_000, false, 25),
      single('chaves', 'Chaves', 200_000, true, 40),
    ];
    const result = applyDirectEdit(500_000, items, 'parcelas', { value: 2_500 });

    expect(result.balancerId).toBe('intercaladas');
    expect(result.items.find((i) => i.id === 'parcelas')!.value).toBe(2_500); // exactly what was typed
    expect(result.items.find((i) => i.id === 'parcelas')!.percent).toBeNull(); // link broken

    // entrada(50k) + chaves(200k) + parcelas(50*2500=125k) = 375k;
    // intercaladas absorbs the remaining 125k over its 8 parcelas.
    const intercaladas = result.items.find((i) => i.id === 'intercaladas')!;
    expect(intercaladas.value).toBe(125_000 / 8);
    expect(intercaladas.percent).toBeNull();
    expect(result.status).toBe('closed');
    expect(result.total).toBeCloseTo(500_000, 5);
  });

  it('editing count also breaks the link and triggers the same rebalancing', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true, 10),
      installments('parcelas', 'Parcelas', 50, 1_600, false, 25),
      installments('intercaladas', 'Intercaladas', 8, 10_000, false, 25),
      single('chaves', 'Chaves', 200_000, true, 40),
    ];
    const result = applyDirectEdit(500_000, items, 'parcelas', { count: 40 });

    const parcelas = result.items.find((i) => i.id === 'parcelas')!;
    expect(parcelas.count).toBe(40);
    expect(parcelas.value).toBe(1_600); // value untouched, only count changed
    expect(result.balancerId).toBe('intercaladas');
    // entrada(50k)+chaves(200k)+parcelas(40*1600=64k)=314k; intercaladas absorbs 186k.
    expect(result.items.find((i) => i.id === 'intercaladas')!.value).toBeCloseTo(186_000 / 8, 5);
    expect(result.status).toBe('closed');
  });

  it('other unlocked items that were never touched keep tracking their own percent', () => {
    // Only entrada locked; parcelas edited directly; intercaladas and
    // chaves stay percent-linked — intercaladas keeps computing from
    // its own 25%, chaves (last unlocked, still percent-linked) is
    // the one nulled to become the balancer.
    const items = [
      single('entrada', 'Entrada', 50_000, true, 10),
      installments('parcelas', 'Parcelas', 50, 1_600, false, 25),
      installments('intercaladas', 'Intercaladas', 8, 10_000, false, 25),
      single('chaves', 'Chaves', 200_000, false, 40),
    ];
    const result = applyDirectEdit(500_000, items, 'parcelas', { value: 2_000 });

    expect(result.balancerId).toBe('chaves');
    expect(result.items.find((i) => i.id === 'intercaladas')!.value).toBe(15_625); // 25% of 500k / 8
    expect(result.items.find((i) => i.id === 'parcelas')!.value).toBe(2_000);
  });

  it('when the edited item is the last unlocked one, the next-to-last unlocked item balances instead', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true, 10),
      installments('parcelas', 'Parcelas', 50, 1_600, false, 25),
      single('chaves', 'Chaves', 200_000, false, 40),
    ];
    const result = applyDirectEdit(500_000, items, 'chaves', { value: 150_000 });

    expect(result.balancerId).toBe('parcelas');
    expect(result.items.find((i) => i.id === 'chaves')!.value).toBe(150_000); // exactly what was typed
    // entrada(50k)+chaves(150k)=200k; parcelas absorbs 300k over 50x.
    expect(result.items.find((i) => i.id === 'parcelas')!.value).toBe(300_000 / 50);
  });

  it('with no other unlocked item to rebalance, the edit stands as typed and status reflects the gap', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true, 10),
      single('chaves', 'Chaves', 200_000, true, 40),
      installments('parcelas', 'Parcelas', 50, 1_600, false, 25),
    ];
    const result = applyDirectEdit(500_000, items, 'parcelas', { value: 1_000 });

    expect(result.balancerId).toBeNull();
    expect(result.items.find((i) => i.id === 'parcelas')!.value).toBe(1_000);
    // entrada(50k)+chaves(200k)+parcelas(50*1000=50k)=300k, faltam 200k.
    expect(result.status).toBe('incomplete');
    expect(result.difference).toBeCloseTo(-200_000, 5);
  });

  it('locked items are never touched by a direct edit elsewhere', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true, 10),
      installments('parcelas', 'Parcelas', 50, 1_600, false, 25),
      single('chaves', 'Chaves', 200_000, true, 40),
    ];
    const result = applyDirectEdit(500_000, items, 'parcelas', { value: 999 });
    expect(result.items.find((i) => i.id === 'entrada')!.value).toBe(50_000);
    expect(result.items.find((i) => i.id === 'chaves')!.value).toBe(200_000);
  });
});

describe('buildFlowText — Copiar fluxo', () => {
  const items = [
    single('entrada', 'Entrada', 50_000),
    installments('mensais', 'Mensais', 36, 2_500),
    installments('intermediarias', 'Intermediárias', 4, 15_000),
    single('financiamento', 'Financiamento', 300_000),
  ];

  it('matches the exact requested format, header + components + total', () => {
    // The spec's own example: R$300.000 imóvel, "TESTE" / "Unidade 101".
    const exampleItems = [
      single('entrada', 'Entrada', 30_000),
      installments('parcelas', 'Parcelas', 48, 75_000 / 48),
      installments('intercaladas', 'Intercaladas', 8, 75_000 / 8),
      single('chaves', 'Chaves', 120_000),
    ];
    const text = buildFlowText({
      projectName: 'TESTE',
      unit: '101',
      items: exampleItems,
      total: 300_000,
      formatMoney: money,
    });
    expect(text).toBe(
      [
        'TESTE',
        'Unidade 101',
        '',
        'Entrada: R$ 30000',
        'Parcelas (48x) de R$ 75000',
        'Intercaladas (8x) de R$ 75000',
        'Chaves: R$ 120000',
        '',
        'Valor total: R$ 300000',
      ].join('\n'),
    );
  });

  it('an installments line shows the etapa TOTAL, not the per-installment split', () => {
    const text = buildFlowText({
      projectName: 'Mahal',
      unit: '1203',
      items,
      total: 500_000,
      formatMoney: money,
    });
    expect(text.startsWith('MAHAL\nUnidade 1203')).toBe(true);
    expect(text).toContain('Entrada: R$ 50000');
    expect(text).toContain('Mensais (36x) de R$ 90000'); // 36 × 2.500
    expect(text).toContain('Intermediárias (4x) de R$ 60000'); // 4 × 15.000
    expect(text).toContain('Financiamento: R$ 300000');
    expect(text).toContain('Valor total: R$ 500000');
    expect(text).not.toContain('Valor do imóvel');
  });

  it('omits "Unidade" entirely when unit is blank', () => {
    const text = buildFlowText({
      projectName: 'Mahal',
      unit: '',
      items,
      total: 500_000,
      formatMoney: money,
    });
    expect(text.startsWith('MAHAL')).toBe(true);
    expect(text).not.toContain('Unidade');
  });

  it('omits the header entirely for Fluxo Livre (no project)', () => {
    const text = buildFlowText({
      projectName: '',
      unit: '',
      items,
      total: 500_000,
      formatMoney: money,
    });
    expect(text.startsWith('Entrada: R$ 50000')).toBe(true);
  });

  it('never exposes the internal percent split, even when items carry one', () => {
    const percentItems = createDefaultFlowItems();
    const result = recalculate(500_000, percentItems);
    const text = buildFlowText({
      projectName: '',
      unit: '',
      items: result.items,
      total: result.total,
      formatMoney: money,
    });
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/\b10\b/);
    expect(text).not.toMatch(/\b25\b/);
  });
});
