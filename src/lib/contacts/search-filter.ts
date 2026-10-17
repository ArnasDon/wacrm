export function sanitizeContactSearch(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} +@.\-_]/gu, '').trim();
}

export interface ContactSearchOptions {
  includeEmail?: boolean;
}

export function contactSearchFilter(
  rawSearch: string,
  { includeEmail = false }: ContactSearchOptions = {}
): string | null {
  const search = sanitizeContactSearch(rawSearch);
  if (!search) return null;
  const textPattern = search.replace(/_/g, '\\_');
  const conditions = [`name.ilike.*${textPattern}*`];
  const phoneDigits = search.replace(/\D/g, '');
  if (phoneDigits) conditions.push(`phone.ilike.*${phoneDigits}*`);
  if (includeEmail) conditions.push(`email.ilike.*${textPattern}*`);
  return conditions.join(',');
}
