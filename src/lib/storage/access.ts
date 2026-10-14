import 'server-only';
import { storageBucket, StorageError } from './filesystem';
import { hasMinRole } from '@/lib/auth/roles';
import type { LocalAccountContext } from '@/lib/db/context-core';
export function uploadBucket(value: string, context: LocalAccountContext) {
  const bucket = storageBucket(value);
  const minimum = bucket === 'avatars' ? 'viewer' : bucket === 'flow-media' ? 'admin' : 'agent';
  if (!hasMinRole(context.role, minimum)) throw new StorageError('Insufficient upload permissions.', 403);
  return bucket;
}
export function mediaPublicURL(bucket: string, id: string, filename: string) {
  const base = process.env.APP_PUBLIC_URL ?? process.env.BETTER_AUTH_URL;
  if (!base) throw new Error('Configure APP_PUBLIC_URL for media URLs.');
  const origin = new URL(base);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Invalid public media origin.');
  return new URL(`/media/${bucket}/${id}/${encodeURIComponent(filename)}`, origin.origin).href;
}
