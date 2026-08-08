/**
 * Reads a Request body as text, capped at `maxBytes`.
 *
 * `request.text()` buffers the entire body in memory regardless of size —
 * fine for authenticated routes, but the WhatsApp/Evolution Go webhooks are
 * public and unauthenticated until *after* the body is read (signature/token
 * verification needs the raw bytes first). Without a cap, an anonymous
 * POST with a multi-GB body exhausts the single Node process serving every
 * tenant before any auth check runs. `Content-Length` alone isn't enough —
 * it can be absent (chunked transfer) or spoofed — so this reads the
 * stream incrementally and aborts as soon as the limit is crossed.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > maxBytes) {
    return { ok: false }
  }

  const reader = request.body?.getReader()
  if (!reader) {
    // No body stream (e.g. empty request) — treat as empty text.
    return { ok: true, text: '' }
  }

  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return { ok: false }
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(merged) }
}
