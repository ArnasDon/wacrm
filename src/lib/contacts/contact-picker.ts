export const CONTACT_PICKER_LIMIT = 50;

export function withSelectedContact<T extends { id: string }>(
  results: readonly T[],
  selected: T | null | undefined,
): T[] {
  if (!selected || results.some((c) => c.id === selected.id)) return [...results];
  return [selected, ...results];
}
