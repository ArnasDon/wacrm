export const REPLY_TARGET_MIN = 1;
export const REPLY_TARGET_MAX = 1440;

export function parseReplyTarget(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= REPLY_TARGET_MIN && value <= REPLY_TARGET_MAX ? value : null;
}
