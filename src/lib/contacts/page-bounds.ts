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
