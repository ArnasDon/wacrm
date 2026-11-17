export interface StageLike {
  id: string;
  pipeline_id: string;
  name: string;
  color: string;
  position: number;
}

export function sortByPosition<T extends StageLike>(stages: readonly T[]): T[] {
  return [...stages].sort((a, b) => a.position - b.position);
}

export function reconcileStages<T extends StageLike>(
  local: readonly T[],
  incoming: readonly T[],
): T[] {
  const incomingIds = new Set(incoming.map((s) => s.id));
  const localIds = new Set(local.map((s) => s.id));
  const kept = local.filter((s) => incomingIds.has(s.id));
  const added = sortByPosition(incoming.filter((s) => !localIds.has(s.id)));
  return [...kept, ...added];
}

export function buildStageUpdateRows(
  local: readonly StageLike[],
  existingIds: ReadonlySet<string>,
): StageLike[] {
  return local
    .filter((s) => existingIds.has(s.id))
    .map((s, i) => ({
      id: s.id,
      pipeline_id: s.pipeline_id,
      name: s.name,
      color: s.color,
      position: i,
    }));
}
