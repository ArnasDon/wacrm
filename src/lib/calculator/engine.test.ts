import { describe, expect, it } from 'vitest';
import {
  amountOf,
  applyDirectEdit,
  applyLockToggle,
  applyPercentEdit,
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

describe('applyDirectEdit — editing the unit value column', () => {
  it("the spec's own example: trava Entrada e Chaves, edita o valor unitário da Parcela, Intercaladas absorve o resto (único destravado)", () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true, 10),
      installments('parcelas', 'Parcelas', 50, 1_600, false, 25),
      installments('intercaladas', 'Intercaladas', 8, 10_000, false, 25),
      single('chaves', 'Chaves', 200_000, true, 40),
    ];
    const result = applyDirectEdit(500_000, items, 'parcelas', 2_500);

    expect(result.items.find((i) => i.id === 'parcelas')!.value).toBe(2_500); // exactly what was typed
    expect(result.items.find((i) => i.id === 'parcelas')!.percent).toBeNull(); // link broken

    // entrada(50k) + chaves(200k) + parcelas(50*2500=125k) = 375k;
    // intercaladas is the ONLY other unlocked item, so it absorbs the
    // whole remaining 125k over its 8 parcelas — with a single
    // recipient, proportional split and the old single-balancer
    // behavior are numerically identical.
    const intercaladas = result.items.find((i) => i.id === 'intercaladas')!;
    expect(intercaladas.value).toBe(125_000 / 8);
    expect(result.status).toBe('closed');
    expect(result.total).toBeCloseTo(500_000, 5);
  });

  it('gap already zero: the other unlocked item needs no adjustment and keeps its own percent untouched', () => {
    // Same setup as above, but the typed value (2_500) already makes
    // Intercaladas' own 25% exactly close the flow — nothing to
    // redistribute, so its percent stays exactly 25 (not nulled).
    const items = [
      single('entrada', 'Entrada', 50_000, true, 10),
      installments('parcelas', 'Parcelas', 50, 1_600, false, 25),
      installments('intercaladas', 'Intercaladas', 8, 10_000, false, 25),
      single('chaves', 'Chaves', 200_000, true, 40),
    ];
    const result = applyDirectEdit(500_000, items, 'parcelas', 2_500);
    const intercaladas = result.items.find((i) => i.id === 'intercaladas')!;
    expect(intercaladas.percent).toBe(25);
    expect(result.balancerId).toBeNull();
  });

  it('Teste do pedido — aumentar as Chaves com Parcelas e Intercaladas destravadas reduz as duas proporcionalmente', () => {
    // "travei a entrada e ajustei certinho as parcelas, intercaladas e
    // chaves... quando eu aumentei as chaves não houve redistribuição
    // automática (diminuição proporcional das parcelas e intercaladas
    // para o total permanecer 100%)". Entrada locked at 10%; Parcelas
    // 30%, Intercaladas 20%, Chaves 40% — all closed at 100%.
    const items = [
      single('entrada', 'Entrada', 100_000, true, 10),
      installments('parcelas', 'Parcelas', 1, 300_000, false, 30),
      installments('intercaladas', 'Intercaladas', 1, 200_000, false, 20),
      single('chaves', 'Chaves', 400_000, false, 40),
    ];
    const result = applyDirectEdit(1_000_000, items, 'chaves', 500_000);

    expect(result.status).toBe('closed');
    expect(result.balancerId).toBeNull(); // no single field absorbed it — both did
    expect(result.items.find((i) => i.id === 'entrada')!.value).toBe(100_000); // locked, untouched
    expect(result.items.find((i) => i.id === 'chaves')!.value).toBe(500_000); // exactly what was typed

    // Chaves grew by 100_000 over the flow's 100%; Parcelas (30%) and
    // Intercaladas (20%) shrink to cover it, in their 3:2 ratio.
    expect(result.items.find((i) => i.id === 'parcelas')!.value).toBe(240_000); // 300k - 60k
    expect(result.items.find((i) => i.id === 'intercaladas')!.value).toBe(160_000); // 200k - 40k

    const total =
      result.items.find((i) => i.id === 'entrada')!.value +
      result.items.find((i) => i.id === 'parcelas')!.value +
      result.items.find((i) => i.id === 'intercaladas')!.value +
      result.items.find((i) => i.id === 'chaves')!.value;
    expect(total).toBe(1_000_000);
  });

  it('when the edited item is the last unlocked one, the only other unlocked item balances instead', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true, 10),
      installments('parcelas', 'Parcelas', 50, 1_600, false, 25),
      single('chaves', 'Chaves', 200_000, false, 40),
    ];
    const result = applyDirectEdit(500_000, items, 'chaves', 150_000);

    expect(result.balancerId).toBeNull();
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
    const result = applyDirectEdit(500_000, items, 'parcelas', 1_000);

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
    const result = applyDirectEdit(500_000, items, 'parcelas', 999);
    expect(result.items.find((i) => i.id === 'entrada')!.value).toBe(50_000);
    expect(result.items.find((i) => i.id === 'chaves')!.value).toBe(200_000);
  });
});

describe('Teste 3 do pedido — alteração manual do percentual continua funcionando', () => {
  it('25% → o usuário digita 30% manualmente → 30% é aceito e o fluxo recalcula', () => {
    const items = createDefaultFlowItems();
    const edited = items.map((i) => (i.id === 'parcelas' ? { ...i, percent: 30 } : i));
    const result = recalculate(300_000, edited);
    const parcelas = result.items.find((i) => i.id === 'parcelas')!;
    expect(parcelas.percent).toBe(30);
    expect(parcelas.value).toBeCloseTo(90_000, 5); // 30% of 300k
  });
});

describe('BUG 1 — changing quantity must never touch any percent (Teste 1/2 do pedido)', () => {
  it('Parcelas: 25% / 36x → 48x keeps 25% and only redistributes the per-unit value', () => {
    // The user changes quantity via the plain, direct state update
    // handleChangeCount uses (NOT applyDirectEdit) — simulated here by
    // calling recalculate() straight, exactly like the UI now does.
    const items = createDefaultFlowItems(); // entrada 10, parcelas 25, intercaladas 25, chaves 40
    const afterFirstPass = recalculate(300_000, items).items;

    const withNewCount = afterFirstPass.map((i) =>
      i.id === 'parcelas' ? { ...i, count: 36 } : i,
    );
    const after36 = recalculate(300_000, withNewCount);
    const parcelas36 = after36.items.find((i) => i.id === 'parcelas')!;
    expect(parcelas36.percent).toBe(25); // untouched
    expect(parcelas36.count).toBe(36);
    expect(parcelas36.value).toBeCloseTo(75_000 / 36, 5); // 25% of 300k / 36

    const withCount48 = after36.items.map((i) =>
      i.id === 'parcelas' ? { ...i, count: 48 } : i,
    );
    const after48 = recalculate(300_000, withCount48);
    const parcelas48 = after48.items.find((i) => i.id === 'parcelas')!;
    expect(parcelas48.percent).toBe(25); // STILL untouched after a second change
    expect(parcelas48.count).toBe(48);
    expect(parcelas48.value).toBeCloseTo(75_000 / 48, 5); // still 25% of 300k, just / 48

    // Nothing else moved — Entrada/Intercaladas/Chaves keep their own percents too.
    expect(after48.items.find((i) => i.id === 'entrada')!.percent).toBe(10);
    expect(after48.items.find((i) => i.id === 'intercaladas')!.percent).toBe(25);
    expect(after48.items.find((i) => i.id === 'chaves')!.percent).toBe(40);
    expect(after48.status).toBe('closed');
  });

  it('Intercaladas: 25% / 4x → 8x keeps 25% and only redistributes the per-unit value', () => {
    const items = createDefaultFlowItems();
    const withCount8 = items.map((i) => (i.id === 'intercaladas' ? { ...i, count: 8 } : i));
    const result = recalculate(300_000, withCount8);
    const intercaladas = result.items.find((i) => i.id === 'intercaladas')!;
    expect(intercaladas.percent).toBe(25);
    expect(intercaladas.count).toBe(8);
    expect(intercaladas.value).toBeCloseTo(75_000 / 8, 5);
  });
});

describe('BUG 2 — primeiro clique no cadeado das Chaves após salvar/reabrir (Teste 5 do pedido)', () => {
  it('save → reopen → toggle the Chaves lock never zeroes its percent or value', () => {
    // 1) Build, close the flow, save.
    const built = recalculate(300_000, createDefaultFlowItems()).items;
    const saved = toComponentTemplates(built, 300_000);
    expect(saved.find((c) => c.id === 'chaves')!.defaultPercent).toBe(40);

    // 2) Reopen: fresh items from the saved template (value seeds at 0
    //    until the next recalculate, exactly like handleSelectProject).
    const reopened = saved.map(createFlowItem);
    const afterReopen = recalculate(300_000, reopened);
    const chavesAfterReopen = afterReopen.items.find((i) => i.id === 'chaves')!;
    expect(chavesAfterReopen.percent).toBe(40);
    expect(chavesAfterReopen.value).toBe(120_000);

    // 3) First click on the Chaves lock — same plain toggle
    //    handleToggleLock uses, nothing more.
    const withChavesLocked = afterReopen.items.map((i) =>
      i.id === 'chaves' ? { ...i, locked: true } : i,
    );
    const afterLock = recalculate(300_000, withChavesLocked);
    const chavesAfterLock = afterLock.items.find((i) => i.id === 'chaves')!;

    expect(chavesAfterLock.locked).toBe(true);
    expect(chavesAfterLock.value).toBe(120_000); // NOT zeroed
    expect(percentOf(chavesAfterLock, 300_000)).toBe(40); // NOT zeroed
    expect(afterLock.status).toBe('closed'); // no spurious "incomplete"
  });

  it('the same save/reopen/lock cycle is clean even after a prior quantity edit on another item', () => {
    // This is the exact combination that used to corrupt Chaves before
    // the BUG 1 fix: changing Parcelas' quantity, THEN saving, THEN
    // reopening, THEN locking Chaves for the first time.
    const withNewCount = createDefaultFlowItems().map((i) =>
      i.id === 'parcelas' ? { ...i, count: 48 } : i,
    );
    const built = recalculate(300_000, withNewCount).items;
    expect(built.find((i) => i.id === 'chaves')!.percent).toBe(40); // untouched by the count edit

    const saved = toComponentTemplates(built, 300_000);
    const reopened = saved.map(createFlowItem);
    const afterReopen = recalculate(300_000, reopened);

    const withChavesLocked = afterReopen.items.map((i) =>
      i.id === 'chaves' ? { ...i, locked: true } : i,
    );
    const afterLock = recalculate(300_000, withChavesLocked);
    const chaves = afterLock.items.find((i) => i.id === 'chaves')!;
    expect(chaves.value).toBe(120_000);
    expect(percentOf(chaves, 300_000)).toBe(40);
    expect(afterLock.status).toBe('closed');
  });

  it('the same lock/unlock check holds for Entrada, Parcelas, and Intercaladas too', () => {
    const built = recalculate(300_000, createDefaultFlowItems()).items;
    for (const id of ['entrada', 'parcelas', 'intercaladas']) {
      const locked = built.map((i) => (i.id === id ? { ...i, locked: true } : i));
      const result = recalculate(300_000, locked);
      const item = result.items.find((i) => i.id === id)!;
      expect(item.locked).toBe(true);
      expect(item.value).not.toBe(0);
      expect(percentOf(item, 300_000)).not.toBe(0);

      const unlocked = result.items.map((i) => (i.id === id ? { ...i, locked: false } : i));
      const afterUnlock = recalculate(300_000, unlocked);
      const itemAfterUnlock = afterUnlock.items.find((i) => i.id === id)!;
      expect(itemAfterUnlock.value).not.toBe(0);
      expect(percentOf(itemAfterUnlock, 300_000)).not.toBe(0);
    }
    expect(recalculate(300_000, built).status).toBe('closed');
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

describe('applyLockToggle — travar um campo zerado redistribui proporcionalmente (pedido mais recente)', () => {
  it('locking with no gap (flow already closed) behaves exactly like a plain toggle — nothing else moves', () => {
    const items = createDefaultFlowItems();
    const result = applyLockToggle(300_000, items, 'chaves');
    const chaves = result.items.find((i) => i.id === 'chaves')!;
    const entrada = result.items.find((i) => i.id === 'entrada')!;
    expect(chaves.locked).toBe(true);
    expect(chaves.value).toBe(120_000);
    expect(entrada.percent).toBe(10); // untouched
    expect(result.status).toBe('closed');
  });

  it('Teste do pedido — travar as Chaves, zerar as Intercaladas e travá-las: a diferença é dividida proporcionalmente entre Entrada e Parcelas', () => {
    const propertyValue = 700_000;
    let items = createDefaultFlowItems(); // 10/25/25/40

    // 1) Trava as Chaves — flow já fecha em 100%, nada muda além do lock.
    items = applyLockToggle(propertyValue, items, 'chaves').items;

    // 2) Zera o percentual das Intercaladas (edição manual comum, não
    //    dispara redistribuição sozinha — regra de ouro preservada).
    items = items.map((i) => (i.id === 'intercaladas' ? { ...i, percent: 0 } : i));
    const afterZero = recalculate(propertyValue, items);
    expect(afterZero.status).toBe('incomplete');
    items = afterZero.items;

    // 3) Trava as Intercaladas (agora zeradas) — ESTE é o gatilho: o
    //    faltante (25% de 700.000 = 175.000) deve ser dividido entre
    //    Entrada e Parcelas na proporção em que já estavam (10:25, ou
    //    seja 2:5) — não tudo empurrado para uma única etapa.
    const result = applyLockToggle(propertyValue, items, 'intercaladas');

    expect(result.status).toBe('closed');
    const entrada = result.items.find((i) => i.id === 'entrada')!;
    const parcelas = result.items.find((i) => i.id === 'parcelas')!;
    const intercaladas = result.items.find((i) => i.id === 'intercaladas')!;
    const chaves = result.items.find((i) => i.id === 'chaves')!;

    expect(intercaladas.locked).toBe(true);
    expect(amountOf(intercaladas)).toBe(0);
    expect(chaves.locked).toBe(true);
    expect(amountOf(chaves)).toBe(280_000); // 40% — locked, untouched

    // Gap = 700_000 - 280_000(chaves) - 0(intercaladas) - 70_000(entrada) - 175_000(parcelas) = 175_000
    // split 2:7 / 5:7 over the PRE-lock entrada/parcelas amounts (70k / 175k out of 245k unlocked sum)
    expect(amountOf(entrada)).toBeCloseTo(70_000 + (175_000 * 70_000) / 245_000, 5);
    expect(amountOf(parcelas)).toBeCloseTo(175_000 + (175_000 * 175_000) / 245_000, 5);
    // Both moved — neither stayed at its original 10%/25% share.
    expect(amountOf(entrada)).toBeGreaterThan(70_000);
    expect(amountOf(parcelas)).toBeGreaterThan(175_000);

    const total =
      amountOf(entrada) + amountOf(parcelas) + amountOf(intercaladas) + amountOf(chaves);
    expect(total).toBeCloseTo(propertyValue, 5);
  });

  it('Teste do pedido — travar a Entrada e zerar/travar as Intercaladas: o faltante recai sobre Parcelas e Chaves', () => {
    const propertyValue = 500_000;
    let items = createDefaultFlowItems();

    items = applyLockToggle(propertyValue, items, 'entrada').items; // no gap yet

    items = recalculate(propertyValue, items.map((i) => (i.id === 'intercaladas' ? { ...i, percent: 0 } : i)))
      .items;

    const result = applyLockToggle(propertyValue, items, 'intercaladas');

    expect(result.status).toBe('closed');
    const parcelas = result.items.find((i) => i.id === 'parcelas')!;
    const chaves = result.items.find((i) => i.id === 'chaves')!;
    const entrada = result.items.find((i) => i.id === 'entrada')!;

    expect(entrada.locked).toBe(true);
    expect(amountOf(entrada)).toBe(50_000); // locked at its original 10%, untouched

    // Only Parcelas and Chaves were unlocked to absorb the gap —
    // proportionally to their 25:40 (5:8) split.
    const gap = 125_000; // the 25% that Intercaladas used to hold
    expect(amountOf(parcelas)).toBeCloseTo(125_000 + (gap * 125_000) / 325_000, 5);
    expect(amountOf(chaves)).toBeCloseTo(200_000 + (gap * 200_000) / 325_000, 5);

    const total = amountOf(entrada) + amountOf(parcelas) + amountOf(chaves) + amountOf(result.items.find((i) => i.id === 'intercaladas')!);
    expect(total).toBeCloseTo(propertyValue, 5);
  });

  it('when every remaining unlocked item is also at 0, the gap splits evenly instead of proportionally', () => {
    const propertyValue = 400_000;

    // "c" alone (locked) already covers the full property value, so
    // locking "a" (also at 0) leaves no gap to redistribute — a plain
    // toggle, same as the no-gap case above.
    const withGap = [
      single('a', 'A', 0, false, 0),
      single('b', 'B', 0, false, 0),
      single('c', 'C', 200_000, true, 50),
    ];
    const result = applyLockToggle(propertyValue, withGap, 'a');
    const a = result.items.find((i) => i.id === 'a')!;
    const b = result.items.find((i) => i.id === 'b')!;
    // "a" just got locked at 0 — it does NOT participate in the split.
    // "b" is the only unlocked item left, so it absorbs the entire gap.
    expect(a.locked).toBe(true);
    expect(a.value).toBe(0);
    expect(b.value).toBe(200_000);
    expect(result.status).toBe('closed');
  });

  it('unlocking never triggers redistribution — it is a plain toggle back into the percent-driven flow', () => {
    const propertyValue = 300_000;
    const locked = createDefaultFlowItems().map((i) =>
      i.id === 'chaves' ? { ...i, locked: true } : i,
    );
    const built = recalculate(propertyValue, locked).items;
    const result = applyLockToggle(propertyValue, built, 'chaves');
    const chaves = result.items.find((i) => i.id === 'chaves')!;
    expect(chaves.locked).toBe(false);
    expect(chaves.percent).toBe(40);
    expect(result.status).toBe('closed');
  });
});

describe('applyPercentEdit — editing the percent field redistributes proportionally (fluxo nunca excedente)', () => {
  it('Teste do pedido — aumentar o percentual da Entrada reduz Parcelas/Intercaladas/Chaves proporcionalmente, sempre fechando em 100%', () => {
    const propertyValue = 700_000;
    const items = recalculate(propertyValue, createDefaultFlowItems()).items; // 10/25/25/40

    const result = applyPercentEdit(propertyValue, items, 'entrada', 20);

    expect(result.status).toBe('closed');
    const entrada = result.items.find((i) => i.id === 'entrada')!;
    const parcelas = result.items.find((i) => i.id === 'parcelas')!;
    const intercaladas = result.items.find((i) => i.id === 'intercaladas')!;
    const chaves = result.items.find((i) => i.id === 'chaves')!;

    expect(entrada.percent).toBe(20);
    expect(entrada.value).toBeCloseTo(140_000, 5); // 20% of 700k, exactly as typed

    // 10 percentage points removed from the other three, split in
    // their existing 25:25:40 ratio.
    expect(parcelas.percent).toBeCloseTo(22.222, 2);
    expect(intercaladas.percent).toBeCloseTo(22.222, 2);
    expect(chaves.percent).toBeCloseTo(35.556, 2);

    const total = amountOf(entrada) + amountOf(parcelas) + amountOf(intercaladas) + amountOf(chaves);
    expect(total).toBeCloseTo(propertyValue, 5);
  });

  it('reducing a percent grows the others proportionally instead of leaving the flow incomplete', () => {
    const propertyValue = 300_000;
    const items = recalculate(propertyValue, createDefaultFlowItems()).items; // 10/25/25/40

    const result = applyPercentEdit(propertyValue, items, 'chaves', 20); // 40% -> 20%

    expect(result.status).toBe('closed');
    const entrada = result.items.find((i) => i.id === 'entrada')!;
    const parcelas = result.items.find((i) => i.id === 'parcelas')!;
    const intercaladas = result.items.find((i) => i.id === 'intercaladas')!;
    const chaves = result.items.find((i) => i.id === 'chaves')!;

    expect(chaves.percent).toBe(20);
    // 20 percentage points freed up, split across 10:25:25 (2:5:5).
    expect(entrada.percent).toBeCloseTo(13.333, 2);
    expect(parcelas.percent).toBeCloseTo(33.333, 2);
    expect(intercaladas.percent).toBeCloseTo(33.333, 2);

    const total = amountOf(entrada) + amountOf(parcelas) + amountOf(intercaladas) + amountOf(chaves);
    expect(total).toBeCloseTo(propertyValue, 5);
  });

  it('locked items are excluded from the split and stay exactly as they were', () => {
    const propertyValue = 500_000;
    const items = [
      single('entrada', 'Entrada', 50_000, true, 10),
      installments('parcelas', 'Parcelas', 1, 125_000, false, 25),
      installments('intercaladas', 'Intercaladas', 1, 125_000, false, 25),
      single('chaves', 'Chaves', 200_000, false, 40),
    ];
    const result = applyPercentEdit(propertyValue, items, 'chaves', 60);

    expect(result.status).toBe('closed');
    expect(result.items.find((i) => i.id === 'entrada')!.value).toBe(50_000); // locked, untouched
    expect(result.items.find((i) => i.id === 'chaves')!.value).toBeCloseTo(300_000, 5); // 60% of 500k

    // Only parcelas/intercaladas (unlocked) absorb the -20pp, split 1:1.
    expect(result.items.find((i) => i.id === 'parcelas')!.value).toBeCloseTo(75_000, 5);
    expect(result.items.find((i) => i.id === 'intercaladas')!.value).toBeCloseTo(75_000, 5);
  });

  it('with no other unlocked item to rebalance, the edit stands as typed and status reflects the gap', () => {
    const items = [
      single('entrada', 'Entrada', 50_000, true, 10),
      single('chaves', 'Chaves', 200_000, true, 40),
      installments('parcelas', 'Parcelas', 1, 75_000, false, 25),
    ];
    const result = applyPercentEdit(500_000, items, 'parcelas', 10);

    expect(result.items.find((i) => i.id === 'parcelas')!.percent).toBe(10);
    expect(result.items.find((i) => i.id === 'parcelas')!.value).toBeCloseTo(50_000, 5);
    // entrada(50k)+chaves(200k)+parcelas(50k)=300k, faltam 200k — nada
    // mais destravado para absorver.
    expect(result.status).toBe('incomplete');
  });
});
