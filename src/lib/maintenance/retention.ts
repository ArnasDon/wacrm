import type { SupabaseClient } from '@supabase/supabase-js';

export const CHAT_MEDIA_RETENTION_DAYS = 15;

interface StorageObject {
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
  metadata?: unknown;
}

export function isExpiredStorageObject(
  object: StorageObject,
  cutoff: Date
): boolean {
  const timestamp = object.created_at ?? object.updated_at;
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) && time < cutoff.getTime();
}

async function isReferenced(admin: SupabaseClient, path: string) {
  const { data, error } = await admin
    .from('messages')
    .select('id')
    .like('media_url', `%/chat-media/${path}`)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Remove old chat-media uploads only when no message references them.
 * flow-media is intentionally excluded because flow definitions can keep
 * those assets indefinitely. Work is capped to keep the daily cron cheap.
 */
export async function pruneOrphanedChatMedia(
  admin: SupabaseClient,
  options: { dryRun: boolean; limit?: number; now?: Date }
) {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  const now = options.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - CHAT_MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  const bucket = admin.storage.from('chat-media');
  const { data: folders, error: folderError } = await bucket.list('', {
    limit: 1000,
  });
  if (folderError) throw folderError;

  let scanned = 0;
  let orphaned = 0;
  let deleted = 0;

  for (const folder of folders ?? []) {
    if (!folder.name.startsWith('account-') || scanned >= limit) continue;
    const { data: objects, error } = await bucket.list(folder.name, {
      limit: Math.min(limit - scanned, 1000),
      sortBy: { column: 'created_at', order: 'asc' },
    });
    if (error) throw error;

    for (const object of objects ?? []) {
      if (scanned >= limit) break;
      scanned++;
      if (!isExpiredStorageObject(object, cutoff)) continue;
      const path = `${folder.name}/${object.name}`;
      if (await isReferenced(admin, path)) continue;
      orphaned++;
      if (!options.dryRun) {
        const { error: deleteError } = await bucket.remove([path]);
        if (deleteError) throw deleteError;
        deleted++;
      }
    }
  }

  return { scanned, orphaned, deleted, cutoff: cutoff.toISOString() };
}
