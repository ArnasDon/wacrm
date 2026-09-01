export interface NormalizedInventory {
  quantity: number
  availability: string | null
}

export function normalizeInventory(
  quantity: number | null | undefined,
  availability: string | null | undefined,
): NormalizedInventory {
  const normalizedQuantity = typeof quantity === 'number' ? Math.max(0, Math.floor(quantity)) : 0
  const trimmedAvailability = availability?.trim() ?? ''

  if (normalizedQuantity === 0) {
    return {
      quantity: 0,
      availability: 'out of stock',
    }
  }

  return {
    quantity: normalizedQuantity,
    availability: trimmedAvailability || 'in stock',
  }
}
