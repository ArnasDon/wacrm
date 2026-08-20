import { supabaseAdmin } from "./admin-client";
import { renderPdfPreview } from "./pdf-preview";
import { isDeliverableUrl } from "@/lib/webhooks/ssrf";
import { MEDIA_MAX_BYTES_BY_KIND } from "@/lib/storage/upload-media";

/** True when the mime type or filename extension indicates a PDF —
 *  the only document kind this feature generates a preview for (see
 *  074_document_preview.sql). Checked before doing any real work so a
 *  Word/Excel/PPT/txt document never triggers a wasted PDF-parse
 *  attempt (pdf-to-img would just fail on it and we'd fall back
 *  anyway, but this skips that round-trip). */
export function looksLikePdf(mimeType: string | null, filename: string | null): boolean {
  if (mimeType === "application/pdf") return true;
  return !!filename && filename.toLowerCase().endsWith(".pdf");
}

export interface GenerateDocumentPreviewArgs {
  messageId: string;
  accountId: string;
  pdfBuffer: Buffer;
}

/**
 * Renders page 1 of a just-received or just-sent PDF, uploads it to the
 * account's `chat-media` bucket, and patches the message row with the
 * thumbnail URL + page count + file size. Best-effort and non-blocking
 * by design (never throws) — callers fire this without awaiting, same
 * as the other post-send/post-insert side effects in this codebase
 * (see `maybeActivateCtwaFep`). Worst case the message keeps the plain
 * document pill it already renders while this hasn't (or never)
 * completed.
 */
export async function generateDocumentPreview({
  messageId,
  accountId,
  pdfBuffer,
}: GenerateDocumentPreviewArgs): Promise<void> {
  try {
    const preview = await renderPdfPreview(pdfBuffer);
    if (!preview) return;

    const path = `account-${accountId}/doc-thumbs/${messageId}.png`;
    const { error: uploadError } = await supabaseAdmin()
      .storage.from("chat-media")
      .upload(path, preview.thumbnail, {
        contentType: "image/png",
        upsert: true,
      });
    if (uploadError) {
      console.error("[documents] thumbnail upload failed:", uploadError);
      return;
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin().storage.from("chat-media").getPublicUrl(path);

    const { error: updateError } = await supabaseAdmin()
      .from("messages")
      .update({
        document_page_count: preview.pageCount,
        document_file_size: pdfBuffer.byteLength,
        document_thumbnail_url: publicUrl,
      })
      .eq("id", messageId);
    if (updateError) {
      console.error("[documents] message preview update failed:", updateError);
    }
  } catch (error) {
    console.error("[documents] preview generation failed:", error);
  }
}

/**
 * Outbound-send variant: fetches the PDF bytes from its own media_url
 * (a `chat-media` public URL for a composer upload, or whatever a Flow's
 * `send_media` node was configured with) before generating the preview.
 * SSRF-guarded the same way outbound webhook delivery is — this is our
 * server fetching a URL that isn't always one we control — and size-
 * capped to the same ceiling document uploads are already held to, so a
 * misconfigured external URL can't make this download unbounded.
 */
export async function generateDocumentPreviewFromUrl({
  messageId,
  accountId,
  url,
}: {
  messageId: string;
  accountId: string;
  url: string;
}): Promise<void> {
  try {
    if (!(await isDeliverableUrl(url))) return;

    const response = await fetch(url);
    if (!response.ok) return;

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MEDIA_MAX_BYTES_BY_KIND.document) {
      return;
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    if (pdfBuffer.byteLength > MEDIA_MAX_BYTES_BY_KIND.document) return;

    await generateDocumentPreview({ messageId, accountId, pdfBuffer });
  } catch (error) {
    console.error("[documents] preview fetch failed:", error);
  }
}
