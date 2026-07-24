/**
 * Short opaque codes for tracked links (migration 040).
 *
 * A Meta ad carries its own referral in the webhook payload — nothing
 * else does. For Google Ads, a landing page, or a printed flyer, the
 * only channel back to us is the pre-filled WhatsApp message itself:
 * the tracked-link redirect (src/app/l/[slug]/route.ts) appends a
 * tag like `[#a1b2c3]` to the message text, and the webhook looks for
 * that tag on the first inbound message.
 *
 * Because the customer *sees* this code (it's sitting in their message
 * box before they hit send), it has to be short and visually inert —
 * not a security token. Nothing sensitive depends on it: guessing
 * another account's code at worst misattributes one lead, so 36^6
 * (~2 billion) keyspace is about legibility, not entropy.
 */

import { randomInt } from 'node:crypto';

const CODE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const CODE_LENGTH = 6;

/** Generate a fresh slug/code. Also used as the tracked link's URL slug. */
export function generateRefCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

export function isValidRefCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]{4,12}$/.test(value);
}

/** The tag appended to a tracked link's pre-filled message. */
export function formatRefTag(code: string): string {
  return `[#${code}]`;
}

// Matches the LAST `[#code]` in the text — a customer could type
// their own message before sending, but the tag we appended survives
// at the end unless they specifically delete it.
const REF_TAG_PATTERN = /\[#([a-z0-9]{4,12})\]\s*$/i;

/**
 * Pull a ref code back out of an inbound message's text, if present.
 * Case-insensitive on input, normalised to lowercase to match how
 * `generateRefCode` produces codes and how they're stored.
 */
export function extractRefCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(REF_TAG_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

/** Append the ref tag to a message template for the redirect's wa.me link. */
export function buildPrefilledMessage(template: string, code: string): string {
  const trimmed = template.trim();
  const tag = formatRefTag(code);
  return trimmed ? `${trimmed} ${tag}` : tag;
}
