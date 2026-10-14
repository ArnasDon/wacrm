import { getLocalAccountContext, withAccount } from '@/lib/db/context';
import { readInboundMediaToken } from '@/lib/db/inbound';
import { RequestError, localErrorResponse } from '@/lib/api/local-route';
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params;
    if (!/^\d{1,100}$/.test(mediaId))
      throw new RequestError('Invalid media ID.');
    const context = await getLocalAccountContext();
    const encrypted = await withAccount(context, (db) =>
      readInboundMediaToken(db, context.accountId, mediaId)
    );
    if (!encrypted) throw new RequestError('Media not found.', 404);
    const accessToken = decrypt(encrypted);
    const info = await getMediaUrl({ mediaId, accessToken });
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: info.url,
      accessToken,
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          contentType || info.mimeType || 'application/octet-stream',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return localErrorResponse(error);
  }
}
