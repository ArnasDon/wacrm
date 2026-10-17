export function lastPageIndex(totalCount: number, pageSize: number): number {
  return Math.max(0, Math.ceil(totalCount / pageSize) - 1);
}

export function pageAfterShrink(
  page: number,
  totalCount: number,
  pageSize: number,
  countIsExact = true
): number {
  if (!countIsExact) return Math.max(0, page - 1);
  return Math.min(page, lastPageIndex(totalCount, pageSize));
}

export interface RangeErrorLike {
  code?: string | null;
  details?: string | null;
}

const RANGE_NOT_SATISFIABLE = 'PGRST103';

export function pageAfterRangeError(
  page: number,
  pageSize: number,
  error: RangeErrorLike
): number | null {
  if (error.code !== RANGE_NOT_SATISFIABLE) return null;
  const total = error.details?.match(/only (\d+) rows?/)?.[1];
  if (total === undefined) return Math.max(0, page - 1);
  return Math.min(Math.max(0, page - 1), lastPageIndex(Number(total), pageSize));
}
