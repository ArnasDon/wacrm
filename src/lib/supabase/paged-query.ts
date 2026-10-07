export const PAGE_SIZE = 1000;
export const IN_CHUNK_SIZE = 100;

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export function chunk<T>(values: readonly T[], size = IN_CHUNK_SIZE): T[][] {
  if (size < 1) throw new RangeError('chunk size must be at least 1');
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await fetchPage(
      rows.length,
      rows.length + pageSize - 1,
    );
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return rows;
    for (const row of data) rows.push(row);
  }
}

export async function fetchAllInChunks<T, V>(
  values: readonly V[],
  fetchPage: (
    values: V[],
    from: number,
    to: number,
  ) => PromiseLike<PageResult<T>>,
  chunkSize = IN_CHUNK_SIZE,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (const slice of chunk(values, chunkSize)) {
    const page = await fetchAllPages(
      (from, to) => fetchPage(slice, from, to),
      pageSize,
    );
    for (const row of page) rows.push(row);
  }
  return rows;
}
