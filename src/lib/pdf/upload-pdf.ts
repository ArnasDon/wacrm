import type { SupabaseClient } from '@supabase/supabase-js'
import { buildMediaPath } from '@/lib/storage/upload-media'

/**
 * Uploads a server-generated PDF (quote or full catalog) to the
 * `catalog-documents` bucket and returns its public URL — the
 * account-scoped path convention (`buildMediaPath`) is the same one
 * `chat-media`/`product-media` use, but the upload itself goes through
 * the service-role client since this always runs in a route handler,
 * never the browser.
 */
export async function uploadCatalogPdf(
  db: SupabaseClient,
  accountId: string,
  filename: string,
  pdf: Buffer,
): Promise<string> {
  const path = buildMediaPath(accountId, filename)
  const { error } = await db.storage.from('catalog-documents').upload(path, pdf, {
    cacheControl: '3600',
    upsert: true,
    contentType: 'application/pdf',
  })
  if (error) throw new Error(`Failed to upload PDF: ${error.message}`)
  const { data } = db.storage.from('catalog-documents').getPublicUrl(path)
  return data.publicUrl
}
