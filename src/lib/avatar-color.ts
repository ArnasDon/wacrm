/**
 * WhatsApp-style avatar colors — a contact with no profile photo gets a
 * deterministic color pulled from a small palette (hashed from their
 * name/phone) instead of one flat neutral circle for every contact.
 * Same identifier always resolves to the same color, across renders and
 * across every surface that shows this contact (inbox, contact sheet,
 * pipeline card, …).
 *
 * Colors are soft tints (low-opacity fill + a readable mid-tone label),
 * matching the tint vocabulary already used for tags and status chips
 * elsewhere in the app — not saturated fills, so a wall of avatars still
 * reads as calm rather than a confetti of solid color.
 */

const AVATAR_PALETTE = [
  { bg: "bg-red-500/15", text: "text-red-600 dark:text-red-300" },
  { bg: "bg-orange-500/15", text: "text-orange-600 dark:text-orange-300" },
  { bg: "bg-amber-500/15", text: "text-amber-700 dark:text-amber-300" },
  { bg: "bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-300" },
  { bg: "bg-teal-500/15", text: "text-teal-600 dark:text-teal-300" },
  { bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-300" },
  { bg: "bg-violet-500/15", text: "text-violet-600 dark:text-violet-300" },
  { bg: "bg-pink-500/15", text: "text-pink-600 dark:text-pink-300" },
] as const;

export interface AvatarColor {
  bg: string;
  text: string;
}

/** Deterministic hash so the same name/phone always lands on the same tile. */
function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Pick a color for an avatar fallback from a stable identifier — pass the
 * contact's name if they have one, otherwise their phone number (mirrors
 * how WhatsApp itself colors unsaved contacts by number).
 */
export function getAvatarColor(seed: string): AvatarColor {
  if (!seed) return AVATAR_PALETTE[0];
  const index = hashSeed(seed) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}
