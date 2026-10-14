import type {downloadMedia} from "./meta-api";
import {extensionForMime} from "@/lib/media/filename";
export interface MirrorInboundMediaArgs {
  /** Tenant. Drives the account-scoped path the bucket's policies expect. */
  accountId: string;
  /** Meta's media id. Makes the object path deterministic. */
  mediaId: string;
  /** Short-lived CDN URL from `getMediaUrl`. */
  downloadUrl: string;
  accessToken: string;
  /** Meta's `mime_type` for the media. */
  mimeType?: string | null;
  /** Meta's `file_size`, when it gave us one — lets us skip before downloading. */
  fileSize?: number | null;
  /** `document.filename`, when the sender's client supplied one. */
  fileName?: string | null;
  /** Meta's message timestamp (epoch SECONDS) — keeps download names distinct. */
  messageTimestamp?: string | number | null;
  /** Injected in tests. */
  download?: typeof downloadMedia;
}

/**
 * Lower-case a MIME type and drop its parameters, so `audio/ogg;
 * codecs=opus` — which is what Meta actually sends for a voice note —
 * is matched against the bucket's allow-list as plain `audio/ogg`.
 * Returns null for anything unusable.
 */
export function normalizeMimeType(value?: string | null): string | null {
  if (!value) return null;
  const base = value.split(";")[0].trim().toLowerCase();
  return base.includes("/") ? base : null;
}

/**
 * Coarse noun for a MIME type, used to build a readable download name.
 * Deliberately matches the `content_type` vocabulary in the UI rather
 * than the MIME top-level (`application/*` reads as "document").
 */
function kindForMime(mimeType: string | null): string {
  if (!mimeType) return "file";
  const [top] = mimeType.split("/");
  if (top === "image" || top === "video" || top === "audio") return top;
  if (top === "text" || top === "application") return "document";
  return "file";
}

/**
 * The object's filename inside the account folder. Pure, so the naming
 * rules can be tested without a Storage client.
 *
 * Prefixed with the media id, which makes the whole path deterministic:
 * a Meta redelivery of the same message rewrites the same object rather
 * than littering the bucket with a second copy. The id is stripped back
 * off when a download name is derived, because `basenameFromUrl`
 * (`@/lib/media/filename`) drops a leading run of 10+ digits — the same
 * rule that hides `buildMediaPath`'s epoch prefix on outbound uploads.
 * So the agent saves `invoice.pdf`, not `1234567890123456-invoice.pdf`.
 *
 * Names are kept short on purpose: `buildMediaPath` caps the basename it
 * receives at 40 characters, and a 19-digit media id plus a separator
 * already spends half of that. Hence `image-<epoch>` rather than
 * `whatsapp-image-<epoch>` — the latter truncates.
 */
export function mirrorFileName(args: {
  mediaId: string;
  mimeType: string | null;
  fileName?: string | null;
  messageTimestamp?: string | number | null;
}): string {
  const { mediaId, mimeType, fileName, messageTimestamp } = args;
  const ext = extensionForMime(mimeType);

  // A document's own name is the best download name there is, so keep
  // it. Strip any directory part and its extension — `buildMediaPath`
  // re-derives the extension from whatever we hand it, and we'd rather
  // that come from the MIME type than from a sender-controlled string.
  const stem = (fileName ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, "")
    .trim();
  if (stem) return `${mediaId}-${stem}.${ext}`;

  // Otherwise synthesise. The message timestamp is in the name so that
  // saving two photos out of one thread doesn't produce two files with
  // the same name — and it's Meta's timestamp, not the clock, so the
  // path stays deterministic across a redelivery.
  const kind = kindForMime(mimeType);
  const stamp = String(messageTimestamp ?? "").replace(/\D/g, "");
  return `${mediaId}-${stamp ? `${kind}-${stamp}` : kind}.${ext}`;
}

