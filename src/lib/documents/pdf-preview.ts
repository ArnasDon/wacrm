import { pdf } from "pdf-to-img";

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
 */
export async function renderPdfPreview(pdfBuffer: Buffer): Promise<PdfPreview | null> {
  try {
    const document = await pdf(pdfBuffer, { scale: 1.5 });
    if (document.length < 1) return null;
    const thumbnail = await document.getPage(1);
    return { pageCount: document.length, thumbnail };
  } catch (error) {
    console.error("[documents] PDF preview render failed:", error);
    return null;
  }
}
