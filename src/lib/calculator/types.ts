// Calculadora de Fluxo Imobiliário — isolated domain types.
//
// Deliberately separate from src/types/index.ts (which only carries
// the raw `CalcProject` DB row). Everything simulation-related lives
// here so the module's logic stays self-contained per the "isolamento"
// requirement — nothing outside src/lib/calculator and
// src/components/calculator needs to know these shapes.

/** A single flow line — "Entrada", "Mensais", "Financiamento", etc.
 *
 * `kind: 'single'` — one amount (entrada, financiamento, an avulsa
 * intermediária...). `value` IS the contribution in R$.
 *
 * `kind: 'installments'` — N parcelas de R$ X (mensais, intermediárias
 * parceladas...). `value` is the PER-INSTALLMENT amount; the line's
 * total contribution is `count * value`. `count` is a structural
 * choice the user sets directly and the engine never overwrites it —
 * only `value` is ever auto-adjusted when the item is the balancer.
 */
export type FlowItemKind = 'single' | 'installments';

export interface FlowItem {
  /** Stable key, stays constant across recalculation and edits. */
  id: string;
  label: string;
  kind: FlowItemKind;
  /** When true, the engine never changes `value`, `count`, or `percent`. */
  locked: boolean;
  value: number;
  /** Only meaningful for kind === 'installments'; always >= 1. */
  count: number;
  /**
   * Percent-of-property-value link, or null for a pure R$ item. When
   * set on a free (unlocked, non-balancer) item, the engine derives
   * `value` from `percent/100 * propertyValue` on every recalculation
   * — editing the R$ amount directly breaks the link (sets this back
   * to null) so a manual override never gets silently overwritten by
   * a later property-value change. Purely internal to the calculator;
   * never surfaced in the "Copiar fluxo" text.
   */
  percent: number | null;
}

/** The reusable, per-unit-agnostic shape of an empreendimento's flow —
 *  what gets persisted in calc_projects.components. No amounts here,
 *  just which lines exist, in what order, and their starting state. */
export interface FlowComponentTemplate {
  id: string;
  label: string;
  kind: FlowItemKind;
  defaultLocked: boolean;
  /** Seed count for installments components (e.g. 36 mensais). */
  defaultCount?: number;
  /** Seed percent-of-property-value link (e.g. 10 for entrada). */
  defaultPercent?: number;
}

export type FlowStatus = 'incomplete' | 'excess' | 'closed';

export interface FlowResult {
  items: FlowItem[];
  /** Sum of every item's contribution (locked + free). */
  total: number;
  /** total - propertyValue. Negative when incomplete, positive when excess. */
  difference: number;
  status: FlowStatus;
  /** id of the item the engine is currently auto-balancing, if any
   *  (last unlocked item in list order). Null when every item is
   *  locked — nothing left for the engine to adjust. */
  balancerId: string | null;
}

export interface CalculatorState {
  /** null = Fluxo Livre. */
  projectId: string | null;
  projectName: string;
  unit: string;
  propertyValue: number;
  items: FlowItem[];
}
