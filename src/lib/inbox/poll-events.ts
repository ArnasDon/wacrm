export interface SnapshotEvent<T> { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: T; old: Partial<T> }
export function snapshotEvents<T extends { id: string }>(previous: T[] | null, current: T[], includeDeletes = false): SnapshotEvent<T>[] {
  if (!previous) return [];
  const prior = new Map(previous.map(row => [row.id, row]));
  const events: SnapshotEvent<T>[] = [];
  for (const row of current) {
    const old = prior.get(row.id);
    if (!old) events.push({ eventType: 'INSERT', new: row, old: {} });
    else if (JSON.stringify(old) !== JSON.stringify(row)) events.push({ eventType: 'UPDATE', new: row, old });
    prior.delete(row.id);
  }
  if (includeDeletes) for (const row of prior.values()) events.push({ eventType: 'DELETE', new: {} as T, old: row });
  return events;
}
