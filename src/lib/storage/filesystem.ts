import 'server-only';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
export const STORAGE_BUCKETS = ['avatars', 'chat-media', 'flow-media'] as const;
export type StorageBucket = typeof STORAGE_BUCKETS[number];
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const mediaTypes = new Set([...imageTypes, 'audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'video/mp4', 'video/3gpp', 'video/webm', 'application/pdf', 'text/plain', 'text/csv', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']);
export class StorageError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export function storageBucket(value: string): StorageBucket {
  if (!STORAGE_BUCKETS.includes(value as StorageBucket)) throw new StorageError('Unknown upload bucket.');
  return value as StorageBucket;
}
function objectId(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new StorageError('Invalid object path.');
  return value;
}
export function validateStoredType(bucket: StorageBucket, value: string) {
  const mime = value.split(';')[0].trim().toLowerCase();
  if (!(bucket === 'avatars' ? imageTypes : mediaTypes).has(mime)) throw new StorageError('Unsupported file type.');
  return mime;
}
export function storageRoot() { return resolve(process.env.LOCAL_STORAGE_ROOT ?? 'local-data/uploads'); }
async function filePath(root: string, bucket: string, id: string, create: boolean) {
  storageBucket(bucket); objectId(id);
  const absolute = resolve(root);
  if (create) await mkdir(absolute, { recursive: true, mode: 0o700 });
  if ((await lstat(absolute)).isSymbolicLink()) throw new StorageError('Unsafe storage root link.');
  const canonical = await realpath(absolute);
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  if (normalize(canonical) !== normalize(absolute)) throw new StorageError('Unsafe storage root path link.');
  const directory = join(canonical, bucket);
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new StorageError('Unsafe storage bucket link.');
  const resolvedDirectory = await realpath(directory);
  if (!resolvedDirectory.startsWith(canonical + sep)) throw new StorageError('Unsafe storage path.');
  const file = join(resolvedDirectory, id);
  try { if ((await lstat(file)).isSymbolicLink()) throw new StorageError('Unsafe storage object link.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return file;
}
export async function writeStoredFile(root: string, bucket: StorageBucket, id: string, mime: string, source: AsyncIterable<Uint8Array>, maxBytes?: number) {
  validateStoredType(bucket, mime);
  const limit = Math.min(maxBytes ?? Infinity, bucket === 'avatars' ? 2 * 1024 * 1024 : mime.startsWith('image/') ? 5 * 1024 * 1024 : 16 * 1024 * 1024);
  const path = await filePath(root, bucket, id, true);
  const file = await open(path, 'wx', 0o600);
  let size = 0;
  try {
    for await (const chunk of source) {
      size += chunk.byteLength;
      if (size > limit) throw new StorageError('File is too large.', 413);
      await file.writeFile(chunk);
    }
    if (!size) throw new StorageError('Empty files are not supported.');
    await file.sync();
    await file.close();
    return size;
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(path).catch(() => {});
    throw error;
  }
}
export async function readStoredFile(root: string, bucket: StorageBucket, id: string) {
  const file = await open(await filePath(root, bucket, id, false), 'r');
  try { return await file.readFile(); } finally { await file.close(); }
}
export async function removeStoredFile(root: string, bucket: StorageBucket, id: string) {
  await unlink(await filePath(root, bucket, id, false)).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
