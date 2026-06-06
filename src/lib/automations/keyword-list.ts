export function parseKeywordList(value: string): string[] {
  return value
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export function normalizeKeywordMatchType(value: unknown): 'exact' | 'contains' {
  return value === 'exact' || value === 'contains' ? value : 'contains';
}
