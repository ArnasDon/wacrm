import { uploadResumableMedia } from '@/lib/whatsapp/meta-api'
import { MEDIA_HEADER_SPECS, isMediaHeaderKind } from '@/lib/whatsapp/media-header-types'
import type { TemplatePayload } from '@/lib/whatsapp/template-validators'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

/**
 * Meta requires an `example.header_handle` (from the Resumable Upload
 * API) to create/edit a template with a media header — IMAGE, VIDEO or
 * DOCUMENT alike. A plain public URL is not accepted at creation time
 * and fails with "Invalid parameter" (#230 for images, #562 for the
 * other two). This helper turns the template's `header_media_url`
 * (whether the user uploaded a file or pasted a link) into a handle and
 * writes it onto the payload, so both the upload path and the legacy URL
 * path actually succeed.
 *
 * No-op unless the header is a media header that has a URL but no handle
 * yet. Accepted formats and size ceilings per kind live in
 * `media-header-types.ts` and mirror Meta's Cloud API media reference.
 */

// One message for the SSRF-guard refusal and a genuinely unreachable
// host, across all three media kinds — see the guard comment below.
const UNREACHABLE_MESSAGE =
  'Could not fetch the header media URL. Make sure it is publicly reachable.'

export async function ensureMediaHeaderHandle(
  payload: TemplatePayload,
  accessToken: string,
): Promise<void> {
  const kind = payload.header_type
  if (!isMediaHeaderKind(kind)) return
  if (payload.header_handle) return // already have one
  if (!payload.header_media_url) return // validator already requires url-or-handle

  const spec = MEDIA_HEADER_SPECS[kind]

  const appId = process.env.META_APP_ID
  if (!appId) {
    throw new Error(
      'Media-header templates need META_APP_ID set (used for Meta’s Resumable Upload). Add it to your environment, or remove the media header.',
    )
  }

  // SSRF guard: `header_media_url` is caller-supplied (any authenticated
  // member can submit a template) and the fetch below happens server-side,
  // so refuse any destination that resolves to a private / loopback /
  // link-local / reserved address. Same guard as the two other
  // outbound-fetch call sites (see lib/webhooks/ssrf.ts) — matching the
  // unreachable-host message keeps the failure from being an oracle.
  if (!(await isDeliverableUrl(payload.header_media_url))) {
    throw new Error(UNREACHABLE_MESSAGE)
  }

  // Fetch the sample bytes (works for our uploaded chat-media URL and for
  // a manually-pasted public link).
  let res: Response
  try {
    res = await fetch(payload.header_media_url, {
      // Do NOT follow redirects — a public URL could 3xx-bounce to an
      // internal address, defeating the guard above. Bound the request so
      // a hung host can't tie up the template-submit handler.
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error(UNREACHABLE_MESSAGE)
  }
  if (!res.ok) {
    throw new Error(`Header ${kind} URL returned ${res.status}. It must be publicly reachable.`)
  }

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (contentType && !spec.mimeTypes.includes(contentType)) {
    throw new Error(`Header ${kind} must be ${spec.formats} (got ${contentType}).`)
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0) {
    throw new Error(`Header ${kind} is empty.`)
  }
  if (bytes.byteLength > spec.maxBytes) {
    throw new Error(
      `Header ${kind} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — Meta's limit is ${spec.maxBytes / 1024 / 1024} MB.`,
    )
  }

  // A sample served without a Content-Type is assumed to be the kind's
  // most common format (JPEG / MP4 / PDF).
  const mimeType = spec.mimeTypes.includes(contentType) ? contentType : spec.mimeTypes[0]
  const fileName = `header.${spec.extensions[mimeType]}`

  const { handle } = await uploadResumableMedia({
    appId,
    accessToken,
    fileName,
    mimeType,
    bytes,
  })
  payload.header_handle = handle
}
