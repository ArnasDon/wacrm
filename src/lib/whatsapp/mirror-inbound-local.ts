import 'server-only';
import { downloadMedia } from './meta-api';
import {
  mirrorFileName,
  normalizeMimeType,
  type MirrorInboundMediaArgs,
} from './mirror-inbound-media';
import { persistInboundMedia } from '@/lib/storage/inbound';
import { storageRoot } from '@/lib/storage/filesystem';
import { mediaPublicURL } from '@/lib/storage/access';
import { withTransaction } from '@/lib/db/pool';
export async function mirrorInboundLocal(
  args: Omit<MirrorInboundMediaArgs, 'storage'> & { userId: string }
): Promise<string | null> {
  try {
    if ((args.fileSize ?? 0) > 16 * 1024 * 1024) return null;
    const { buffer, contentType } = await (args.download ?? downloadMedia)({
      downloadUrl: args.downloadUrl,
      accessToken: args.accessToken,
    });
    if (buffer.byteLength > 16 * 1024 * 1024) return null;
    const mime =
      normalizeMimeType(args.mimeType) ??
      normalizeMimeType(contentType) ??
      'application/octet-stream';
    const filename = mirrorFileName({
      mediaId: args.mediaId,
      mimeType: mime,
      fileName: args.fileName,
      messageTimestamp: args.messageTimestamp,
    });
    const stored = await withTransaction(
      (db) =>
        persistInboundMedia(db, storageRoot(), {
          accountId: args.accountId,
          userId: args.userId,
          mediaId: args.mediaId,
          mime,
          filename,
          buffer,
        }),
      'worker'
    );
    return mediaPublicURL('chat-media', stored.id, stored.filename);
  } catch (error) {
    console.warn(
      '[mirror-media] local mirror failed:',
      error instanceof Error ? error.message : 'storage error'
    );
    return null;
  }
}
