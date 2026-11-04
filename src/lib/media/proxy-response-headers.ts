import { extensionForMime } from "./filename";

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

const INLINE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const INLINE_AUDIO_TYPES = new Set([
  "audio/aac",
  "audio/amr",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
]);

const INLINE_VIDEO_TYPES = new Set(["video/mp4", "video/3gpp"]);

const MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

const SAFE_MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const MEDIA_PROXY_CSP = "default-src 'none'; sandbox";

export const MEDIA_PROXY_CACHE_CONTROL = "private, max-age=86400";

export function baseMimeType(contentType?: string | null): string | null {
  if (!contentType) return null;
  const base = contentType.split(";")[0].trim().toLowerCase();
  return MIME_TYPE_PATTERN.test(base) ? base : null;
}

export function isInlineSafeMimeType(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return (
    INLINE_IMAGE_TYPES.has(mimeType) ||
    INLINE_AUDIO_TYPES.has(mimeType) ||
    INLINE_VIDEO_TYPES.has(mimeType)
  );
}

function attachmentDisposition(mediaId: string, mimeType: string): string {
  const extension = extensionForMime(mimeType);
  if (extension === "bin" || !SAFE_MEDIA_ID_PATTERN.test(mediaId)) {
    return "attachment";
  }
  return `attachment; filename="${mediaId}.${extension}"`;
}

export function mediaProxyHeaders(
  mediaId: string,
  contentType?: string | null,
): Record<string, string> {
  const mimeType = baseMimeType(contentType) ?? FALLBACK_CONTENT_TYPE;
  const inline = isInlineSafeMimeType(mimeType);

  return {
    "Content-Type": mimeType,
    "Content-Disposition": inline
      ? "inline"
      : attachmentDisposition(mediaId, mimeType),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": MEDIA_PROXY_CSP,
    "Cache-Control": MEDIA_PROXY_CACHE_CONTROL,
  };
}
