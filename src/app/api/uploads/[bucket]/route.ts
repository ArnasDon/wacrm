import { randomUUID } from 'node:crypto';
import {
  assertSameOrigin,
  localErrorResponse,
  readObject,
  requireUUID,
  RequestError,
} from '@/lib/api/local-route';
import { getLocalAccountContext, withAccount } from '@/lib/db/context';
import { uploadBucket, mediaPublicURL } from '@/lib/storage/access';
import {
  storageRoot,
  validateStoredType,
  writeStoredFile,
  removeStoredFile,
  StorageError,
  type StorageBucket,
} from '@/lib/storage/filesystem';
import { registerStoredObject, deleteStoredObject } from '@/lib/db/storage';
type Context = { params: Promise<{ bucket: string }> };
export const runtime = 'nodejs';
async function* bodyChunks(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      yield part.value;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function errorResponse(error: unknown) {
  return error instanceof StorageError
    ? Response.json({ error: error.message }, { status: error.status })
    : localErrorResponse(error);
}
export async function POST(request: Request, context: Context) {
  let created = false;
  let bucket: StorageBucket | undefined;
  const id = randomUUID();
  try {
    assertSameOrigin(request);
    const account = await getLocalAccountContext();
    bucket = uploadBucket((await context.params).bucket, account);
    const mime = validateStoredType(
      bucket,
      request.headers.get('content-type') ?? ''
    );
    const rawName = decodeURIComponent(
      request.headers.get('x-filename') ?? 'file'
    );
    const filename =
      rawName
        .split(/[\\/]/)
        .pop()!
        .replace(/[\x00-\x1f\x7f]/g, '')
        .slice(0, 180) || 'file';
    const publicUrl = mediaPublicURL(bucket, id, filename);
    if (!request.body) throw new RequestError('File content is required.');
    const bytes = await writeStoredFile(
      storageRoot(),
      bucket,
      id,
      mime,
      bodyChunks(request.body)
    );
    created = true;
    await withAccount(account, (db) =>
      registerStoredObject(db, account.userId, {
        id,
        bucket: bucket!,
        filename,
        mime,
        bytes,
        is_public: true,
      })
    );
    return Response.json(
      { publicUrl, path: id },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (created && bucket)
      await removeStoredFile(storageRoot(), bucket, id).catch(() => {});
    return errorResponse(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const account = await getLocalAccountContext();
    const bucket = uploadBucket((await context.params).bucket, account);
    const id = requireUUID((await readObject(request)).path);
    const object = await withAccount(account, (db) =>
      deleteStoredObject(db, account.accountId, bucket, id)
    );
    if (!object) throw new RequestError('Upload not found.', 404);
    await removeStoredFile(storageRoot(), bucket, id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
