const PHONE_LIKE_SEARCH = /^[\d\s+\-().]+$/;
const MIN_PHONE_SEARCH_DIGITS = 3;

export function sanitizeContactSearch(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} +@.\-_']/gu, '').trim();
}

export function phoneSearchDigits(raw: string): string | null {
  const term = raw.trim();
  if (!PHONE_LIKE_SEARCH.test(term)) return null;
  const digits = term.replace(/\D/g, '');
  return digits.length >= MIN_PHONE_SEARCH_DIGITS ? digits : null;
}

function escapeLikeUnderscore(term: string): string {
  return term.replace(/_/g, '\\_');
}

export function contactSearchPattern(rawSearch: string): string | null {
  const digits = phoneSearchDigits(rawSearch);
  if (digits) return digits;
  const search = sanitizeContactSearch(rawSearch);
  return search ? escapeLikeUnderscore(search) : null;
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
  const textPattern = escapeLikeUnderscore(search);
  const conditions = [`name.ilike.*${textPattern}*`];
  const digits = phoneSearchDigits(rawSearch);
  if (digits) conditions.push(`phone.ilike.*${digits}*`);
  else if (/\d/.test(search)) conditions.push(`phone.ilike.*${textPattern}*`);
  if (includeEmail) conditions.push(`email.ilike.*${textPattern}*`);
  return conditions.join(',');
}
