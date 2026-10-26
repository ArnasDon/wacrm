/**
 * Accepted formats and size ceilings for template media headers (IMAGE /
 * VIDEO / DOCUMENT), mirroring Meta's Cloud API "Supported Media Types"
 * table: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 *
 * Pure constants with no imports so both the server-side handle helper
 * (`template-header-handle.ts`) and the client-side template form can
 * share one source of truth for "what does Meta accept here".
 */

export type MediaHeaderKind = 'image' | 'video' | 'document'

export interface MediaHeaderSpec {
  /** Meta's accepted MIME types. The first entry is the fallback when a
   *  fetched sample carries no Content-Type. */
  mimeTypes: readonly string[]
  /** File extension per MIME type — names the Resumable Upload. */
  extensions: Readonly<Record<string, string>>
  /** Meta's per-sample ceiling for this header type, in bytes. */
  maxBytes: number
  /** Human label of the accepted formats, for error messages. */
  formats: string
}

const MB = 1024 * 1024

export const MEDIA_HEADER_SPECS: Readonly<Record<MediaHeaderKind, MediaHeaderSpec>> = {
  image: {
    mimeTypes: ['image/jpeg', 'image/png'],
    extensions: { 'image/jpeg': 'jpg', 'image/png': 'png' },
    maxBytes: 5 * MB,
    formats: 'JPEG or PNG',
  },
  video: {
    mimeTypes: ['video/mp4', 'video/3gpp'],
    extensions: { 'video/mp4': 'mp4', 'video/3gpp': '3gp' },
    maxBytes: 16 * MB,
    formats: 'MP4 or 3GPP',
  },
  document: {
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
    ],
    extensions: {
      'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.ms-powerpoint': 'ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'text/plain': 'txt',
    },
    maxBytes: 100 * MB,
    formats: 'PDF, Word, PowerPoint, Excel or plain text',
  },
}

export function isMediaHeaderKind(value: unknown): value is MediaHeaderKind {
  return value === 'image' || value === 'video' || value === 'document'
}
