/**
 * Upload template header sample media via Meta's Resumable Upload API.
 *
 * Meta's POST /{waba_id}/message_templates rejects (or 500s on) media
 * headers that use `example.header_url` — they require
 * `example.header_handle` from this flow.
 *
 * @see https://developers.facebook.com/docs/graph-api/guides/upload/
 */

import { META_API_BASE } from './meta-api-version'
import { getMessageTemplateComponents } from './meta-api'
import {
  isHttpMediaUrl,
  isWhatsAppCdnUrl,
  pickUploadHandle,
} from './header-media-source'
import type { TemplatePayload } from './template-validators'

const HEADER_MIME: Record<'image' | 'video' | 'document', string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  document: 'application/pdf',
}

const HEADER_FILENAME: Record<'image' | 'video' | 'document', string> = {
  image: 'header.jpg',
  video: 'header.mp4',
  document: 'header.pdf',
}

interface MetaErrorResponse {
  error?: { message?: string }
}

async function readMetaError(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) return data.error.message
  } catch {
    // keep fallback
  }
  return fallback
}

/** Resolve Meta App ID from env or the access token's debug_token payload. */
export async function resolveMetaAppId(accessToken: string): Promise<string> {
  const fromEnv = process.env.META_APP_ID?.trim()
  if (fromEnv) return fromEnv

  const url = new URL(`${META_API_BASE}/debug_token`)
  url.searchParams.set('input_token', accessToken)
  url.searchParams.set('access_token', accessToken)

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(
      'META_APP_ID is not set and could not be resolved from your WhatsApp token. ' +
        'Add META_APP_ID to the server environment (Meta for Developers → App Settings → Basic).',
    )
  }

  const data = (await response.json()) as { data?: { app_id?: string | number } }
  const appId = data.data?.app_id
  if (!appId) {
    throw new Error(
      'Could not resolve Meta App ID from access token. Set META_APP_ID in the server environment.',
    )
  }
  return String(appId)
}

function resolveMimeType(
  headerType: 'image' | 'video' | 'document',
  contentType: string | null,
): string {
  const trimmed = contentType?.split(';')[0]?.trim()
  if (trimmed && trimmed !== 'application/octet-stream') {
    return trimmed
  }
  return HEADER_MIME[headerType]
}

function filenameForMime(
  headerType: 'image' | 'video' | 'document',
  mimeType: string,
): string {
  const mime = mimeType.toLowerCase()
  if (mime.includes('png')) return 'header.png'
  if (mime.includes('webp')) return 'header.webp'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'header.jpg'
  if (mime.includes('3gpp') || mime.includes('3gp')) return 'header.3gp'
  if (mime.includes('mp4')) return 'header.mp4'
  if (mime.includes('pdf')) return 'header.pdf'
  return HEADER_FILENAME[headerType]
}

async function downloadMediaBytes(
  url: string,
  accessToken: string,
): Promise<{ bytes: ArrayBuffer; contentType: string | null }> {
  const authHeaders = { Authorization: `Bearer ${accessToken}` }
  const attempts: RequestInit[] = isWhatsAppCdnUrl(url)
    ? [{ headers: authHeaders }, {}, { headers: authHeaders }]
    : [{}, { headers: authHeaders }]

  let response: Response | null = null
  for (const init of attempts) {
    response = await fetch(url, init)
    if (response.ok) break
  }

  if (!response?.ok) {
    throw new Error(
      `Could not download header media from URL (HTTP ${response?.status ?? 'unknown'}). ` +
        (isWhatsAppCdnUrl(url)
          ? 'WhatsApp CDN sample URLs expire — upload a new public HTTPS image for the header, or run Sync from Meta and try again.'
          : 'Use a public HTTPS URL that Meta can fetch.'),
    )
  }

  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get('content-type'),
  }
}

export interface UploadHeaderMediaForTemplateCreationArgs {
  appId: string
  accessToken: string
  sourceUrl: string
  headerType: 'image' | 'video' | 'document'
}

/**
 * Download a public sample URL and upload it through Meta Resumable Upload.
 * Returns the `header_handle` string for template creation.
 */
export async function uploadHeaderMediaForTemplateCreation(
  args: UploadHeaderMediaForTemplateCreationArgs,
): Promise<string> {
  const { appId, accessToken, sourceUrl, headerType } = args
  const { bytes, contentType } = await downloadMediaBytes(sourceUrl, accessToken)
  const fileLength = bytes.byteLength
  if (fileLength === 0) {
    throw new Error('Header media file is empty.')
  }

  const mimeType = resolveMimeType(headerType, contentType)
  const fileName = filenameForMime(headerType, mimeType)

  const sessionUrl = new URL(`${META_API_BASE}/${appId}/uploads`)
  sessionUrl.searchParams.set('file_name', fileName)
  sessionUrl.searchParams.set('file_length', String(fileLength))
  sessionUrl.searchParams.set('file_type', mimeType)
  sessionUrl.searchParams.set('access_token', accessToken)

  const sessionRes = await fetch(sessionUrl.toString(), { method: 'POST' })
  if (!sessionRes.ok) {
    const message = await readMetaError(
      sessionRes,
      `Resumable upload session failed: ${sessionRes.status}`,
    )
    throw new Error(message)
  }

  const sessionData = (await sessionRes.json()) as { id?: string }
  const uploadSessionId = sessionData.id
  if (!uploadSessionId) {
    throw new Error('Resumable upload session did not return an id.')
  }

  const uploadRes = await fetch(`${META_API_BASE}/${uploadSessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      'file_offset': '0',
    },
    body: bytes,
  })
  if (!uploadRes.ok) {
    const message = await readMetaError(
      uploadRes,
      `Resumable upload failed: ${uploadRes.status}`,
    )
    throw new Error(message)
  }

  const uploadData = (await uploadRes.json()) as { h?: string }
  if (!uploadData.h?.trim()) {
    throw new Error('Resumable upload did not return a header_handle.')
  }
  return uploadData.h.trim()
}

/** Context from an existing template row — used on PATCH edit. */
export interface PrepareTemplateMediaContext {
  existingHeaderHandle?: string | null
  existingHeaderMediaUrl?: string | null
  metaTemplateId?: string | null
}

async function fetchHeaderHandleFromMeta(
  metaTemplateId: string,
  accessToken: string,
): Promise<string | undefined> {
  const components = await getMessageTemplateComponents(metaTemplateId, accessToken)
  const header = components.find((c) => c.type?.toUpperCase() === 'HEADER')
  const rawHandle = header?.example?.header_handle?.[0]?.trim()
  if (rawHandle && !isHttpMediaUrl(rawHandle)) {
    return rawHandle
  }
  return undefined
}

async function resolveHeaderHandle(
  payload: TemplatePayload,
  accessToken: string,
  context?: PrepareTemplateMediaContext,
): Promise<string | undefined> {
  const fromPayload = pickUploadHandle({ header_handle: payload.header_handle })
  if (fromPayload) return fromPayload

  const mediaUrl = payload.header_media_url?.trim()
  if (!mediaUrl) return undefined

  const headerType = payload.header_type
  if (
    !headerType ||
    (headerType !== 'image' && headerType !== 'video' && headerType !== 'document')
  ) {
    return undefined
  }

  const existingUrl = context?.existingHeaderMediaUrl?.trim()
  const unchanged = Boolean(existingUrl && mediaUrl === existingUrl)

  if (unchanged) {
    const fromDb = pickUploadHandle({
      header_handle: context?.existingHeaderHandle ?? undefined,
    })
    if (fromDb) return fromDb

    if (context?.metaTemplateId) {
      const fromMeta = await fetchHeaderHandleFromMeta(
        context.metaTemplateId,
        accessToken,
      )
      if (fromMeta) return fromMeta
    }
  }

  const appId = await resolveMetaAppId(accessToken)
  return uploadHeaderMediaForTemplateCreation({
    appId,
    accessToken,
    sourceUrl: mediaUrl,
    headerType,
  })
}

/**
 * When the user supplied `header_media_url`, upload it to Meta and attach
 * the resulting `header_handle` before building the template submit payload.
 *
 * On edit, reuses a stored handle or fetches one from Meta when the sample
 * URL is unchanged — avoids re-downloading expiring WhatsApp CDN URLs.
 */
export async function prepareTemplatePayloadForMetaSubmit(
  payload: TemplatePayload,
  accessToken: string,
  context?: PrepareTemplateMediaContext,
): Promise<TemplatePayload> {
  const headerType = payload.header_type
  if (
    !headerType ||
    (headerType !== 'image' && headerType !== 'video' && headerType !== 'document')
  ) {
    return payload
  }

  const mediaUrl = payload.header_media_url?.trim()
  if (!mediaUrl && !payload.header_handle?.trim()) {
    return payload
  }

  const header_handle = await resolveHeaderHandle(payload, accessToken, context)
  if (!header_handle) {
    return payload
  }

  return {
    ...payload,
    header_handle,
    header_media_url: mediaUrl ?? payload.header_media_url,
  }
}
