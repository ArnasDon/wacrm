/**
 * Hand-off when a Groups broadcast starts from /groups.
 * Kept separate from contact-id stash so large groups don't need to
 * materialise every member id in the browser before the wizard opens.
 */

export const BROADCAST_SELECTED_GROUPS_KEY =
  'wacrm:broadcast-selected-group-ids';

export function stashBroadcastGroupIds(ids: readonly string[]): void {
  if (typeof window === 'undefined') return;
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) {
    window.sessionStorage.removeItem(BROADCAST_SELECTED_GROUPS_KEY);
    return;
  }
  window.sessionStorage.setItem(
    BROADCAST_SELECTED_GROUPS_KEY,
    JSON.stringify(unique),
  );
}

export function peekBroadcastGroupIds(): string[] {
  if (typeof window === 'undefined') return [];
  const raw = window.sessionStorage.getItem(BROADCAST_SELECTED_GROUPS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];
  } catch {
    return [];
  }
}

export function clearBroadcastGroupIds(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(BROADCAST_SELECTED_GROUPS_KEY);
}
