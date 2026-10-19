import { format } from "date-fns";
import type { ContentType } from "@/types";

/**
 * Works out the filename to save a chat attachment under.
 *
 * There is no `media_filename` column, so a name has to be reconstructed
 * from what the message row *does* carry. Three sources, in order of
 * trustworthiness:
 *
 *   1. A document's `content_text`. That's where the webhook puts
 *      `document.filename`, and where the composer puts the uploaded file's
 *      name — but only when the sender typed no caption, hence the
 *      "does it look like a filename" guard.
 *   2. The basename of a `chat-media` bucket URL, minus the leading id/epoch
 *      prefix that `buildMediaPath` (`@/lib/storage/upload-media`) puts in
 *      front of it. Covers outbound uploads and, since migration 039,
 *      inbound media mirrored into the same bucket.
 *   3. A synthesised `whatsapp-<kind>-<timestamp>.<ext>`. The extension comes
 *      from `media_type` when the row has one (migration 039 — the webhook
 *      used to discard Meta's MIME type), falling back to whatever the
 *      browser reported for the fetched bytes.
 */

/**
 * Extension per MIME type. Covers the `chat-media` bucket's allow-list
 * (migration 023) plus the inbound-only types Meta can hand us (notably
 * `image/webp` stickers and `audio/ogg` voice notes).
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "text/plain": "txt",
};

/** Longest filename we'll produce, extension included. */
const MAX_FILENAME_LENGTH = 80;

/**
 * Extension for a MIME type, `bin` when unknown. Parameters are stripped,
 * so `image/jpeg; charset=binary` still resolves.
 */
export function extensionForMime(mimeType?: string | null): string {
  if (!mimeType) return "bin";
  const base = mimeType.split(";")[0].trim().toLowerCase();
  return EXTENSION_BY_MIME[base] ?? "bin";
}

/**
 * Strip anything that would make the name unsafe to hand to a download:
 * path separators (a `../` in a Meta-supplied filename must not escape the
 * downloads folder), control characters, and the characters Windows
 * rejects outright. Returns "" when nothing usable survives, so callers
 * can fall through to the next source.
 */
export function sanitizeFilename(raw: string): string {
  const basename = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = basename
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    // Leading dots would make the file hidden (and "." / ".." are not names).
    .replace(/^\.+/, "");
  if (!cleaned) return "";

  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned;

  // Truncate the stem, never the extension — a shortened `.pdf` opens, a
  // truncated one doesn't.
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0) return cleaned.slice(0, MAX_FILENAME_LENGTH);
  const ext = cleaned.slice(dot);
  const stem = cleaned.slice(0, dot);
  return stem.slice(0, Math.max(1, MAX_FILENAME_LENGTH - ext.length)) + ext;
}

/** A trailing `.ext` of 1–8 alphanumerics — good enough to call it a file. */
function hasExtension(name: string): boolean {
  return /\.[A-Za-z0-9]{1,8}$/.test(name);
}

/**
 * Basename of a URL's path, query and fragment dropped, percent-decoded,
 * and with `buildMediaPath`'s `<epoch-ms>-` prefix removed. Returns "" when
 * the URL has no filename-looking last segment (e.g. a proxy URL, whose
 * last segment is a bare Meta media-id).
 */
export function basenameFromUrl(url: string): string {
  let path = url;
  try {
    // Base only matters for the relative-URL case; it's discarded either way.
    path = new URL(url, "http://media.invalid").pathname;
  } catch {
    // Not parseable — fall back to chopping the query off by hand.
    path = url.split(/[?#]/)[0];
  }

  const last = path.split("/").filter(Boolean).pop() ?? "";
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // Malformed escape sequence — keep the raw segment.
  }

  const withoutStamp = decoded.replace(/^\d{10,}-/, "");
  return hasExtension(withoutStamp) ? sanitizeFilename(withoutStamp) : "";
}

export interface MediaFilenameInput {
  content_type: ContentType;
  content_text?: string;
  media_url?: string;
  /** Meta's MIME type for inbound media (migration 039); null on older rows. */
  media_type?: string | null;
  created_at: string;
}

/**
 * Filename for a media message. `mimeType` is what the browser reported
 * for the downloaded bytes (`blob.type`) — pass it when available.
 *
 * The row's own `media_type` takes precedence over it: a `Blob` minted
 * from a response with no usable `Content-Type` has `type === ""`, and
 * some servers answer `application/octet-stream` for everything, both of
 * which resolve to a useless `.bin`. `media_type` is what Meta said the
 * file actually is.
 */
export function mediaFilename(
  message: MediaFilenameInput,
  mimeType?: string | null,
): string {
  // 1. A document's own filename, when the sender didn't replace it with a
  //    caption. Restricted to documents on purpose: an image caption like
  //    "is this the right invoice.pdf" is prose, not a filename.
  if (message.content_type === "document" && message.content_text) {
    const fromText = hasExtension(message.content_text)
      ? sanitizeFilename(message.content_text)
      : "";
    if (fromText) return fromText;
  }

  // 2. The uploaded object's name, for anything we sent ourselves.
  if (message.media_url) {
    const fromUrl = basenameFromUrl(message.media_url);
    if (fromUrl) return fromUrl;
  }

  // 3. Synthesise. Timestamped so saving two photos from one thread doesn't
  //    collide, and prefixed so they're greppable in a downloads folder.
  const stamp = formatStamp(message.created_at);
  const kind = message.content_type || "file";
  const ext = extensionForMime(
    preferKnownMime(message.media_type) ?? mimeType,
  );
  return sanitizeFilename(
    stamp ? `whatsapp-${kind}-${stamp}.${ext}` : `whatsapp-${kind}.${ext}`,
  );
}

/**
 * The stored `media_type`, but only when it maps to a real extension —
 * so a row carrying `application/octet-stream` doesn't beat a browser
 * blob that knows it's a JPEG.
 */
function preferKnownMime(mediaType?: string | null): string | null {
  if (!mediaType) return null;
  return extensionForMime(mediaType) === "bin" ? null : mediaType;
}

function formatStamp(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "yyyyMMdd-HHmmss");
}
