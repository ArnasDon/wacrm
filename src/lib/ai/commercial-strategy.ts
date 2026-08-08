import type { CommercialStrategy } from './types'

export const DEFAULT_COMMERCIAL_STRATEGY: CommercialStrategy = {
  maxProducts: 3,
  preferVisual: true,
  autoRecommend: true,
  checkStock: true,
  keepSelectedProduct: true,
  qualificationOrder: 'size_then_color',
}

export function normalizeCommercialStrategy(
  value: unknown,
): CommercialStrategy {
  const raw = value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}

  const maxProductsRaw = Number(raw.max_products ?? raw.maxProducts)
  const maxProducts = Number.isFinite(maxProductsRaw)
    ? Math.min(10, Math.max(1, Math.floor(maxProductsRaw)))
    : DEFAULT_COMMERCIAL_STRATEGY.maxProducts

  const bool = (snake: string, camel: string, fallback: boolean) => {
    const candidate = raw[snake] ?? raw[camel]
    return typeof candidate === 'boolean' ? candidate : fallback
  }

  const orderRaw = raw.qualification_order ?? raw.qualificationOrder
  const qualificationOrder = orderRaw === 'color_then_size'
    ? 'color_then_size'
    : 'size_then_color'

  return {
    maxProducts,
    preferVisual: bool('prefer_visual', 'preferVisual', true),
    autoRecommend: bool('auto_recommend', 'autoRecommend', true),
    checkStock: bool('check_stock', 'checkStock', true),
    keepSelectedProduct: bool(
      'keep_selected_product',
      'keepSelectedProduct',
      true,
    ),
    qualificationOrder,
  }
}

export function serializeCommercialStrategy(
  strategy: CommercialStrategy,
): Record<string, unknown> {
  return {
    max_products: strategy.maxProducts,
    prefer_visual: strategy.preferVisual,
    auto_recommend: strategy.autoRecommend,
    check_stock: strategy.checkStock,
    keep_selected_product: strategy.keepSelectedProduct,
    qualification_order: strategy.qualificationOrder,
  }
}

export function commercialStrategyPrompt(
  strategy: CommercialStrategy,
): string {
  const qualification = strategy.qualificationOrder === 'color_then_size'
    ? 'colour first, then size'
    : 'size first, then colour'

  const rules = [
    `Present at most ${strategy.maxProducts} product options at a time unless the customer explicitly asks for more.`,
    strategy.preferVisual
      ? 'Prefer visual catalogue results with product photographs when available.'
      : 'Do not require visual catalogue results; concise text results are acceptable unless the customer asks for photographs.',
    strategy.autoRecommend
      ? 'When the customer describes a need rather than naming a product, proactively recommend suitable catalogue products.'
      : 'Do not proactively recommend products unless the customer asks for suggestions.',
    strategy.checkStock
      ? 'Before confirming availability or encouraging a purchase, verify current stock with the available catalogue tools.'
      : 'Do not make stock claims unless stock information is already present in trusted context or tool results.',
    strategy.keepSelectedProduct
      ? 'Once the customer selects or clearly refers to a product, keep that product as the active product context until the customer changes it.'
      : 'Do not assume a previously selected product remains active when the customer changes topic or the reference becomes ambiguous.',
    `When product qualification requires both attributes and they are not already known, ask about ${qualification}. Ask only one useful follow-up question at a time.`,
  ]

  return `Commercial strategy — follow these account-level selling rules:\n${rules
    .map((rule) => `- ${rule}`)
    .join('\n')}`
}
