export interface PdfPreview {
  pageCount: number;
  /** PNG bytes of page 1, rendered at a size close to what the WhatsApp
   *  card shows (a small thumbnail, not a print-quality page). */
  thumbnail: Buffer;
}

/**
 * Renders the first page of a PDF to a PNG thumbnail and reports the
 * page count. Best-effort — returns null (never throws) on anything
 * that isn't a valid, renderable PDF, so a caller can always fall back
 * to the plain document pill. Scale 1.5 keeps the thumbnail close to
 * the ~140px-wide card WhatsApp itself renders without wasting storage
 * on a full-resolution page image.
 *
 * `pdf-to-img` is loaded via a dynamic `import()` inside the try block
 * rather than a static top-level import. `pdf-to-img` pulls in
 * `@napi-rs/canvas`, a native-binding package — on a host where the
 * prebuilt binary for that platform isn't available, loading it throws
 * an uncaught `ReferenceError: DOMMatrix is not defined` (canvas's
 * polyfill setup fails too). A static import makes that throw happen at
 * MODULE LOAD time, which crashed the whole Node process — and because
 * this module is imported (transitively, via generate-document-preview.ts)
 * from both the inbound webhook route and the outbound send path, one
 * broken native dependency took down all of WhatsApp send/receive, not
 * just PDF previews (incident 2026-08-20/21). A dynamic import fails
 * locally to this function instead, so the catch below can do what the
 * docstring above always promised: degrade to no-preview.
 */
export async function renderPdfPreview(pdfBuffer: Buffer): Promise<PdfPreview | null> {
  try {
    const { pdf } = await import("pdf-to-img");
    const document = await pdf(pdfBuffer, { scale: 1.5 });
    if (document.length < 1) return null;
    const thumbnail = await document.getPage(1);
    return { pageCount: document.length, thumbnail };
  } catch (error) {
    console.error("[documents] PDF preview render failed:", error);
    return null;
  }
}
