// Calculadora de Fluxo Imobiliário — calculation engine.
//
// Single source of truth for the flow math. Nothing else in the app
// (or in src/components/calculator) computes totals/balances itself —
// every UI piece calls into these pure functions. Runs entirely
// client-side, no DB round-trip per keystroke.
//
// Rule that isn't spelled out by the product spec (it says the engine
// "may adjust the free fields it needs to" without saying how to split
// a redistribution across MULTIPLE free fields): inside plain
// `recalculate`, the LAST unlocked item WITHOUT a percent link is the
// "balancer" — the only field IT ever auto-computes to force closure.
// Every other unlocked item is either percent-driven (see
// `applyPercent`) or, if it has no percent link either, fully free —
// the user edits it directly and `recalculate` never touches it.
//
// IMPORTANT — a percent-linked item is NEVER eligible as `recalculate`'s
// own balancer, even when it's the only unlocked item left. This is a
// deliberate, narrow widening of the original rule (which used to treat
// "last unlocked, full stop" as the balancer, silently overriding that
// item's own percent to force the total closed). The product requires
// the opposite for percent-driven flows: Entrada/Parcelas/Intercaladas/
// Chaves must each show exactly what their own percentage computes to,
// with NO auto-redistribution from a plain recalculate — if the
// percentages don't sum to 100%, that has to surface as an incomplete/
// excess status, not get papered over by quietly resizing whichever
// item happens to be last. Items with no percent link (legacy
// templates, or a custom "+Adicionar" item — those still seed
// `percent: null`) keep the original balancer behavior unchanged.
//
// `applyDirectEdit` and `applyLockToggle`, below, are the two
// DELIBERATE exceptions to "no auto-redistribution": when the user
// either types a literal value into one etapa or locks one at a value
// that leaves the flow off 100%, the resulting gap IS spread — across
// every OTHER unlocked item at once, proportionally to their current
// share (see `distributeGapProportionally`), not onto a single field.
// The underlying formulas — lockedSum, target, statusFor, EPSILON —
// are untouched either way; only who gets to close the gap, and how
// many fields share that job, differs between the three entry points.

import type { FlowComponentTemplate, FlowItem, FlowResult, FlowStatus } from './types';

/** Below this many reais of difference, the flow counts as "closed" —
 *  guards against floating-point noise (e.g. 299999.9999999998). */
const EPSILON = 0.01;

/**
 * The four standard etapas every new flow (Fluxo Livre, or a brand
 * new empreendimento built from it) starts with, and their default
 * percent-of-property-value split. Always sums to 100% — if that ever
 * needs to change, this is the one place to edit it.
 */
export const DEFAULT_FLOW_COMPONENTS: FlowComponentTemplate[] = [
  {
    id: 'entrada',
    label: 'Entrada',
    kind: 'installments',
    defaultLocked: false,
    defaultCount: 1,
    defaultPercent: 10,
  },
  {
    id: 'parcelas',
    label: 'Parcelas',
    kind: 'installments',
    defaultLocked: false,
    defaultCount: 1,
    defaultPercent: 25,
  },
  {
    id: 'intercaladas',
    label: 'Intercaladas',
    kind: 'installments',
    defaultLocked: false,
    defaultCount: 1,
    defaultPercent: 25,
  },
  { id: 'chaves', label: 'Chaves', kind: 'single', defaultLocked: false, defaultPercent: 40 },
];

export function amountOf(item: FlowItem): number {
  return item.kind === 'single' ? item.value : item.count * item.value;
}

export function createFlowItem(template: FlowComponentTemplate): FlowItem {
  return {
    id: template.id,
    label: template.label,
    kind: template.kind,
    locked: template.defaultLocked,
    value: 0,
    count: template.kind === 'installments' ? Math.max(1, template.defaultCount ?? 1) : 1,
    percent: template.defaultPercent ?? null,
  };
}

/** Fresh copy of the four standard etapas — every "new" Fluxo Livre
 *  session starts from this (each call gets its own item ids so
 *  multiple simulations never share mutable state). */
export function createDefaultFlowItems(): FlowItem[] {
  return DEFAULT_FLOW_COMPONENTS.map(createFlowItem);
}

/**
 * The inverse of `createFlowItem` — freezes a live simulation's items
 * (labels, kinds, locks, counts, percent links) back into a reusable
 * template, for "Salvar como empreendimento" (Fluxo Livre → new
 * project) and "Salvar alterações" (an open project's session →
 * overwrite its saved template). Deliberately drops `value`: amounts
 * are never persisted, only the shape that produces them.
 *
 * An item whose percent link was broken by a direct R$ edit (so
 * `item.percent` is null) still gets a `defaultPercent` here — derived
 * from its CURRENT ratio to `propertyValue` via `percentOf`. Without
 * this, saving as an empreendimento would silently forget a
 * deliberate manual override instead of capturing what's on screen.
 */
export function toComponentTemplates(
  items: FlowItem[],
  propertyValue: number,
): FlowComponentTemplate[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    defaultLocked: item.locked,
    defaultCount: item.kind === 'installments' ? item.count : undefined,
    defaultPercent:
      item.percent ??
      (propertyValue > 0 ? Math.round(percentOf(item, propertyValue) * 10) / 10 : undefined),
  }));
}

function statusFor(difference: number): FlowStatus {
  if (Math.abs(difference) <= EPSILON) return 'closed';
  return difference < 0 ? 'incomplete' : 'excess';
}

function applyPercent(item: FlowItem, propertyValue: number): FlowItem {
  const total = Math.max(0, (item.percent! / 100) * propertyValue);
  if (item.kind === 'single') return { ...item, value: total };
  const count = Math.max(1, item.count);
  return { ...item, count, value: total / count };
}

/**
 * Live percent-of-property-value this item currently represents,
 * for display — independent of whether `item.percent` is set (a
 * locked or balancer item has no percent LINK, but still has a
 * ratio worth showing). Returns 0 when propertyValue is 0 to avoid
 * a division-by-zero NaN in the UI.
 */
export function percentOf(item: FlowItem, propertyValue: number): number {
  if (propertyValue <= 0) return item.percent ?? 0;
  return (amountOf(item) / propertyValue) * 100;
}

/**
 * Recomputes the flow against `propertyValue`. Locked items are
 * returned untouched.
 *
 * Every unlocked item that carries a `percent` link gets its value
 * re-derived from `percent/100 * propertyValue` (split across `count`
 * for installments) — this is what makes the four standard etapas
 * (10/25/25/40) track the property value live, with no field ever
 * silently overridden to force the total closed. A direct edit to an
 * item's R$ amount clears its `percent` (see calculator-view.tsx), so
 * that item stops being percent-driven from then on.
 *
 * The balancer — the LAST unlocked item WITHOUT a percent link — is
 * the one exception: its `value` (or per-installment `value`, given
 * the existing `count`) gets overwritten to close the flow as tightly
 * as possible, clamped at 0 so an already-over-budget flow shows
 * "excess" instead of a negative amount. When every unlocked item has
 * a percent link (the normal case for a percent-driven flow), there
 * is no balancer at all — `balancerId` is null and the flow's total
 * is simply the sum of each item's own percent, exactly as typed. Its
 * distance from `propertyValue` still flows through the same
 * `statusFor`/`EPSILON` closure rule as always, so "the percentages
 * must add up to exactly 100%" and "a locked/free field is never
 * auto-redistributed" both fall out of logic that already existed —
 * nothing new was invented to enforce them.
 */
export function recalculate(
  propertyValue: number,
  items: FlowItem[],
  options?: { balancerId?: string },
): FlowResult {
  const lockedSum = items.filter((i) => i.locked).reduce((sum, i) => sum + amountOf(i), 0);

  const unlockedIndexes = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.locked);

  if (unlockedIndexes.length === 0) {
    const total = lockedSum;
    const difference = total - propertyValue;
    return { items, total, difference, status: statusFor(difference), balancerId: null };
  }

  // `options.balancerId` lets a caller PIN which unlocked item absorbs
  // the remainder for this update (used by `applyDirectEdit` so the
  // item the user just typed into is never the one that gets
  // silently overwritten). Without it, a percent-linked item always
  // determines its own value — it can never be "the balancer" the
  // engine fills in to force closure.
  const balancerEntry = options?.balancerId
    ? (unlockedIndexes.find(({ item }) => item.id === options.balancerId) ?? null)
    : ([...unlockedIndexes].reverse().find(({ item }) => item.percent == null) ?? null);

  const percentAppliedItems = items.map((item, index) => {
    const isUnlocked = unlockedIndexes.some((e) => e.index === index);
    const isBalancer = balancerEntry?.index === index;
    if (isUnlocked && !isBalancer && item.percent != null) return applyPercent(item, propertyValue);
    return item;
  });

  if (!balancerEntry) {
    // Every unlocked item already knows its own value — nothing left
    // for the engine to fill in. Status/difference fall straight out
    // of the same statusFor()/EPSILON rule used everywhere else.
    const total = percentAppliedItems.reduce((sum, i) => sum + amountOf(i), 0);
    const difference = total - propertyValue;
    return {
      items: percentAppliedItems,
      total,
      difference,
      status: statusFor(difference),
      balancerId: null,
    };
  }

  const otherUnlockedSum = unlockedIndexes
    .filter(({ index }) => index !== balancerEntry.index)
    .reduce((sum, { index }) => sum + amountOf(percentAppliedItems[index]), 0);

  const target = Math.max(0, propertyValue - lockedSum - otherUnlockedSum);

  const nextItems = percentAppliedItems.map((item, index) => {
    if (index !== balancerEntry.index) return item;
    if (item.kind === 'single') {
      return { ...item, value: target };
    }
    const count = Math.max(1, item.count);
    return { ...item, count, value: target / count };
  });

  const total = nextItems.reduce((sum, i) => sum + amountOf(i), 0);
  const difference = total - propertyValue;

  return {
    items: nextItems,
    total,
    difference,
    status: statusFor(difference),
    balancerId: balancerEntry.item.id,
  };
}

/**
 * Spreads `gap` (positive = the flow is short by that much, negative =
 * over) across every item in `recipients`, proportionally to each
 * one's CURRENT amount — its share of `recipients`' combined total —
 * or evenly if that total is 0 (nothing to derive a ratio from, e.g.
 * every recipient is itself sitting at zero). Each recipient's
 * `percent` is updated to match its new amount, so afterward it's
 * still a normal percent-driven field (it'll keep tracking THAT new
 * percent if propertyValue changes again), never a one-off literal
 * frozen at today's number. `items` not in `recipients` pass through
 * unchanged. Shared by `applyDirectEdit` and `applyLockToggle` — the
 * two places where one change (typing a literal value into an etapa,
 * locking one) needs to be absorbed by every OTHER unlocked etapa at
 * once, rather than by a single balancer.
 */
function distributeGapProportionally(
  propertyValue: number,
  items: FlowItem[],
  recipients: FlowItem[],
  gap: number,
): FlowItem[] {
  const recipientIds = new Set(recipients.map((item) => item.id));
  const recipientSum = recipients.reduce((sum, item) => sum + amountOf(item), 0);

  return items.map((item) => {
    if (!recipientIds.has(item.id)) return item;
    const share = recipientSum > 0 ? amountOf(item) / recipientSum : 1 / recipients.length;
    const newAmount = Math.max(0, amountOf(item) + gap * share);
    const newPercent = propertyValue > 0 ? (newAmount / propertyValue) * 100 : item.percent;
    if (item.kind === 'single') {
      return { ...item, value: newAmount, percent: newPercent };
    }
    const count = Math.max(1, item.count);
    return { ...item, value: newAmount / count, percent: newPercent };
  });
}

/**
 * Applies a direct edit to an item's per-unit VALUE — the "Valor
 * unitário" column the user can type an R$ amount into. This is one of
 * the two places (with `applyLockToggle`) that revive "negotiation" on
 * top of the percent-driven engine above: "aumentei as Chaves, e as
 * Parcelas e Intercaladas [as duas etapas destravadas] diminuíram
 * proporcionalmente para o total permanecer 100%."
 *
 * IMPORTANT — this function is for VALUE edits only. Editing the
 * installment COUNT is a structural choice, not a "I know this exact
 * amount" declaration, and must never touch anyone's percent — see
 * `handleChangeCount` in calculator-view.tsx, which updates `count`
 * directly and lets the normal percent-driven path in `recalculate`
 * redistribute the per-unit value from the UNCHANGED percent. Routing
 * count edits through here was the root cause of two earlier bugs
 * (changing Parcelas'/Intercaladas' quantity silently zeroing an
 * unrelated item's percent) — quantity must only ever affect the
 * edited item's OWN per-unit value, via its own still-intact percent.
 *
 * What happens, in order:
 * 1. `items` is normalized through `recalculate` first, so every
 *    percent-driven item's amount reflects its CURRENT percent rather
 *    than a stale/seed value (same reasoning as `applyLockToggle`).
 * 2. The edited item gets the new value and its `percent` link is
 *    cleared — it's now a literal number the user typed, not a
 *    percentage the engine derives, so it must never be silently
 *    overwritten by a later propertyValue change.
 * 3. If the edit leaves the flow off `propertyValue` by more than
 *    EPSILON, that gap is spread across EVERY other unlocked item at
 *    once via `distributeGapProportionally` — not dumped onto a single
 *    "balancer". "trava Entrada e Chaves, digita R$2.500 na Parcela" →
 *    with only Intercaladas left unlocked, it alone absorbs 100% of
 *    the gap (a one-recipient proportional split is the same as the
 *    old single-balancer behavior). With Chaves ALSO unlocked, typing
 *    into Parcelas instead spreads the gap across Intercaladas AND
 *    Chaves together, proportional to what each already held.
 * Locked items are — as everywhere else in this engine — never
 * touched by any of this.
 */
export function applyDirectEdit(
  propertyValue: number,
  items: FlowItem[],
  editedId: string,
  value: number,
): FlowResult {
  const normalized = recalculate(propertyValue, items).items;
  const edited = normalized.map((item) =>
    item.id === editedId ? { ...item, value, percent: null } : item,
  );

  const otherUnlocked = edited.filter((item) => !item.locked && item.id !== editedId);
  if (otherUnlocked.length === 0) {
    // Nothing else can absorb the difference — the edit stands exactly
    // as typed. Pass a balancerId that can never match a real item so
    // `recalculate` skips its own auto-search too: otherwise, with the
    // edited item now the ONLY unlocked one left (and percent-null), that
    // search would find it and silently overwrite what was just typed.
    return recalculate(propertyValue, edited, { balancerId: '__none__' });
  }

  const lockedSum = edited.filter((item) => item.locked).reduce((sum, i) => sum + amountOf(i), 0);
  const otherUnlockedSum = otherUnlocked.reduce((sum, i) => sum + amountOf(i), 0);
  const editedAmount = amountOf(edited.find((item) => item.id === editedId)!);
  const gap = propertyValue - lockedSum - editedAmount - otherUnlockedSum;

  const rebalanced =
    Math.abs(gap) <= EPSILON ? edited : distributeGapProportionally(propertyValue, edited, otherUnlocked, gap);

  // Redistribution already closed the flow (or the gap was negligible
  // to begin with) — pass '__none__' so recalculate's own auto-search
  // never mistakes the just-edited item (unlocked, percent: null) for
  // its balancer and overwrites what was just typed.
  return recalculate(propertyValue, rebalanced, { balancerId: '__none__' });
}

/**
 * Toggles an item's lock. Unlocking is a no-op beyond the flag flip —
 * the item just rejoins the normal percent-driven flow that
 * `recalculate` already handles. LOCKING is where this differs from a
 * plain `{ ...item, locked: true }` + `recalculate`:
 *
 * "Toda vez que eu zerar um valor... e travar esse cadeado... é
 * necessário que o valor faltante seja recalculado para as demais
 * etapas que não estão com o cadeado travado" — if freezing this
 * item's amount leaves the flow off 100% (e.g. it was zeroed first),
 * the resulting gap is spread across every OTHER unlocked item via
 * `distributeGapProportionally` — the same mechanism `applyDirectEdit`
 * uses, just triggered by a lock instead of a typed value.
 *
 * When locking doesn't change how close the flow is to 100% (the
 * common case — the four etapas already sum correctly), this is
 * exactly equivalent to the old plain toggle: nothing is touched
 * beyond the `locked` flag.
 */
export function applyLockToggle(propertyValue: number, items: FlowItem[], id: string): FlowResult {
  // Normalize first: `items` may still hold each percent-driven item's
  // stale/seed `value` (e.g. fresh from createFlowItem, before any
  // recalculate has run against the current propertyValue — happens
  // whenever the user's very first action is locking something, with
  // no prior edit to trigger a recalculate). Running it through
  // `recalculate` once brings every unlocked item's value in line with
  // its percent (locked items pass through unchanged either way), so
  // the lockedSum/unlockedSum/gap math below always reflects what's
  // actually on screen, never a leftover placeholder.
  const normalized = recalculate(propertyValue, items).items;
  const toggled = normalized.map((item) =>
    item.id === id ? { ...item, locked: !item.locked } : item,
  );

  const target = toggled.find((item) => item.id === id);
  if (!target?.locked) {
    return recalculate(propertyValue, toggled);
  }

  const unlocked = toggled.filter((item) => !item.locked);
  if (unlocked.length === 0) {
    return recalculate(propertyValue, toggled);
  }

  const lockedSum = toggled.filter((item) => item.locked).reduce((sum, i) => sum + amountOf(i), 0);
  const unlockedSum = unlocked.reduce((sum, i) => sum + amountOf(i), 0);
  const gap = propertyValue - lockedSum - unlockedSum;

  if (Math.abs(gap) <= EPSILON) {
    return recalculate(propertyValue, toggled);
  }

  const rebalanced = distributeGapProportionally(propertyValue, toggled, unlocked, gap);
  return recalculate(propertyValue, rebalanced);
}

/**
 * Plain-text flow summary for the "Copiar fluxo" action — the SAME
 * copy function as always (spec: "não criar uma nova função de
 * cópia"), just producing the exact format requested:
 *
 *   TESTE
 *   Unidade 101
 *
 *   Entrada: R$ 30.000,00
 *   Parcelas (48x) de R$ 75.000,00
 *   Intercaladas (8x) de R$ 75.000,00
 *   Chaves: R$ 120.000,00
 *
 *   Valor total: R$ 300.000,00
 *
 * Header lines (project name, then "Unidade N") appear only when a
 * project/unit is known — Fluxo Livre has neither, so the text starts
 * directly at the component lines. An installments line always shows
 * the etapa's TOTAL contribution (`amountOf`, i.e. percent × property
 * value) alongside its count — "(48x) de R$ 75.000,00" — never the
 * per-installment split; that split is still what `item.value` holds
 * internally and what the on-screen row/resumo show, this is purely
 * about what gets copied to the client. No percent, no emojis, no
 * extra copy — same rule as always.
 */
export function buildFlowText(params: {
  projectName: string;
  unit: string;
  items: FlowItem[];
  total: number;
  formatMoney: (value: number) => string;
}): string {
  const { projectName, unit, items, total, formatMoney } = params;
  const lines: string[] = [];

  const name = projectName.trim();
  if (name) {
    lines.push(name.toUpperCase());
    if (unit.trim()) {
      lines.push(`Unidade ${unit.trim()}`);
    }
    lines.push('');
  }

  for (const item of items) {
    if (item.kind === 'single') {
      lines.push(`${item.label}: ${formatMoney(item.value)}`);
    } else {
      lines.push(`${item.label} (${item.count}x) de ${formatMoney(amountOf(item))}`);
    }
  }

  lines.push('', `Valor total: ${formatMoney(total)}`);

  return lines.join('\n');
}
