import type { SupabaseClient } from '@supabase/supabase-js';
import type { SegmentSummary } from '@/types';

type DB = SupabaseClient;

// ------------------------------------------------------------
// Segments — saved tag combinations that resolve to a live contact
// list (AND semantics, migration 040). Kept as a standalone data
// layer (no UI imports) so a future audience picker in Broadcasts or
// Automations can call `listSegmentsWithCounts` / `resolveSegmentTagIds`
// directly and feed the result straight into the existing
// AudienceConfig.tagIds + matchAll:true shape those flows already use.
// ------------------------------------------------------------

export async function listSegmentsWithCounts(db: DB): Promise<SegmentSummary[]> {
  const { data, error } = await db.rpc('list_segments_with_counts');
  if (error) throw error;
  return (data ?? []) as SegmentSummary[];
}

export interface SaveSegmentInput {
  accountId: string;
  userId: string;
  name: string;
  tagIds: string[];
}

export async function createSegment(db: DB, input: SaveSegmentInput): Promise<string> {
  const { data, error } = await db
    .from('segments')
    .insert({
      account_id: input.accountId,
      user_id: input.userId,
      name: input.name,
    })
    .select('id')
    .single();
  if (error) throw error;

  const segmentId = (data as { id: string }).id;
  await replaceSegmentTags(db, segmentId, input.tagIds);
  return segmentId;
}

export async function updateSegment(
  db: DB,
  segmentId: string,
  input: Pick<SaveSegmentInput, 'name' | 'tagIds'>,
): Promise<void> {
  const { error } = await db
    .from('segments')
    .update({ name: input.name })
    .eq('id', segmentId);
  if (error) throw error;

  await replaceSegmentTags(db, segmentId, input.tagIds);
}

export async function deleteSegment(db: DB, segmentId: string): Promise<void> {
  const { error } = await db.from('segments').delete().eq('id', segmentId);
  if (error) throw error;
}

/**
 * Full replace rather than a diff — segment tag sets are small (a
 * handful of checkboxes) and this is only called on explicit save, so
 * the simplicity of delete-then-insert outweighs the cost of a diff.
 */
async function replaceSegmentTags(db: DB, segmentId: string, tagIds: string[]): Promise<void> {
  const { error: deleteError } = await db
    .from('segment_tags')
    .delete()
    .eq('segment_id', segmentId);
  if (deleteError) throw deleteError;

  if (tagIds.length === 0) return;

  const { error: insertError } = await db
    .from('segment_tags')
    .insert(tagIds.map((tagId) => ({ segment_id: segmentId, tag_id: tagId })));
  if (insertError) throw insertError;
}
