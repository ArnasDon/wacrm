// ============================================================
// Shared upload-size guard (security audit finding ST-N2 —
// "Storage / Archivos / Subidas").
//
// `/api/ai/knowledge/upload-pdf` and `/api/ai/data-sources`
// (`uploaded_csv`) used to call `file.arrayBuffer()` with no size
// check anywhere in the stack — not in the route, not in the service
// layer, and not in `next.config.ts` (no `serverActions.bodySizeLimit`
// is configured, which only applies to Server Actions anyway, not
// Route Handlers). An admin — the only role that can reach either
// route — could upload an arbitrarily large file, forcing the Node
// process to buffer all of it in memory before any rejection. This is
// unlike the Storage-bucket uploads (avatars/flow-media/chat-media),
// which get a real, infrastructure-enforced `file_size_limit` from
// Supabase Storage itself regardless of what the client claims.
//
// Two checks, both before `arrayBuffer()`:
//   1. `contentLengthExceeds` — read the `Content-Length` header
//      BEFORE ever calling `request.formData()`, so an honestly-
//      labelled oversized request is rejected before this process
//      spends any work parsing the multipart body at all. This is the
//      real mitigation for the common case.
//   2. `fileExceeds` — check `File.size` (available synchronously
//      once `formData()` has resolved, no need to read the bytes)
//      right before `arrayBuffer()`, as a correctness backstop for a
//      request that omitted/understated `Content-Length` (chunked
//      transfer-encoding, a non-conforming client, etc.).
// Neither check is a substitute for a true streaming multipart parser
// — that would be a much larger architectural change, out of scope
// for this fix — but together they close the "no limit anywhere"
// gap without one.
// ============================================================

/** Shared ceiling for both upload-pdf and data-sources (uploaded_csv). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB

/** Human-readable size for error messages. */
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024)

/**
 * True if the request declares (via `Content-Length`) a body larger
 * than `maxBytes`. Returns false — never blocks — when the header is
 * absent or unparseable; that case falls through to `fileExceeds`
 * after parsing, which is authoritative either way.
 */
export function contentLengthExceeds(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get('content-length')
  if (!raw) return false
  const len = Number(raw)
  return Number.isFinite(len) && len > maxBytes
}

/** True if a parsed `File`'s reported size exceeds `maxBytes`. */
export function fileExceeds(file: File, maxBytes: number): boolean {
  return file.size > maxBytes
}

/** Standard 413 body for either check above. */
export function fileTooLargeResponse(maxBytes: number = MAX_UPLOAD_BYTES) {
  return {
    body: { error: `File must be ${maxBytes / (1024 * 1024)} MB or smaller.` },
    status: 413 as const,
  }
}
