import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_TAG_COLOR = '#3b82f6';

const NAME_LOOKUP_CHUNK_SIZE = 50;

const LOOKUP_PAGE_SIZE = 1000;

function tagKey(name: string): string {
  return name.trim().toLowerCase();
}

function quotedNamePattern(name: string): string {
  return `"${name.replace(/["\\%*]/g, '_')}"`;
}

async function findTagIdsByName(
  supabase: SupabaseClient,
  accountId: string,
  names: string[]
): Promise<Map<string, string>> {
  const wantedKeys = new Set(names.map(tagKey));
  const tagIdByKey = new Map<string, string>();

  for (let i = 0; i < names.length; i += NAME_LOOKUP_CHUNK_SIZE) {
    const patterns = names
      .slice(i, i + NAME_LOOKUP_CHUNK_SIZE)
      .map(quotedNamePattern);

    for (let offset = 0; ; offset += LOOKUP_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('tags')
        .select('id, name')
        .eq('account_id', accountId)
        .ilikeAnyOf('name', patterns)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + LOOKUP_PAGE_SIZE - 1);

      if (error) throw error;

      const page = data ?? [];
      for (const tag of page) {
        const key = tagKey(tag.name);
        if (wantedKeys.has(key) && !tagIdByKey.has(key)) {
          tagIdByKey.set(key, tag.id);
        }
      }

      if (page.length < LOOKUP_PAGE_SIZE) break;
    }
  }

  return tagIdByKey;
}

interface SupersededTag {
  loserId: string;
  winnerId: string;
}

async function moveContactTagLinks(
  supabase: SupabaseClient,
  { loserId, winnerId }: SupersededTag
): Promise<void> {
  for (let offset = 0; ; offset += LOOKUP_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .eq('tag_id', loserId)
      .order('contact_id', { ascending: true })
      .range(offset, offset + LOOKUP_PAGE_SIZE - 1);

    if (error) throw error;

    const page = data ?? [];
    if (page.length > 0) {
      const { error: upsertError } = await supabase
        .from('contact_tags')
        .upsert(
          page.map((row) => ({ contact_id: row.contact_id, tag_id: winnerId })),
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
        );
      if (upsertError) throw upsertError;
    }

    if (page.length < LOOKUP_PAGE_SIZE) return;
  }
}

async function retireSupersededTag(
  supabase: SupabaseClient,
  accountId: string,
  superseded: SupersededTag
): Promise<void> {
  try {
    await moveContactTagLinks(supabase, superseded);
    const { error } = await supabase
      .from('tags')
      .delete()
      .eq('account_id', accountId)
      .eq('id', superseded.loserId);
    if (error) throw error;
  } catch (error) {
    console.warn(
      '[resolve-import-tags] duplicate tag cleanup failed:',
      (error as { message?: string }).message
    );
  }
}

export interface ResolveImportTagsResult {
  /** Lowercase tag name → tag id. */
  tagIdByKey: Map<string, string>;
  /** Names that could not be matched and were not created. */
  skippedNames: string[];
}

/**
 * Resolve tag names from a CSV import to tag ids. Existing account tags
 * are matched case-insensitively. Missing names are created when
 * `canCreateTags` is true (admin+); otherwise they are reported in
 * `skippedNames`.
 *
 * Unlike the manual contact form (existing tags only), import may
 * auto-create missing tag definitions for admin+ callers.
 */
export async function resolveImportTagIds(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    userId: string;
    tagNames: string[];
    canCreateTags: boolean;
    defaultColor?: string;
  }
): Promise<ResolveImportTagsResult> {
  const { accountId, userId, tagNames, canCreateTags } = params;
  const defaultColor = params.defaultColor ?? DEFAULT_TAG_COLOR;

  const uniqueNames: string[] = [];
  const seen = new Set<string>();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    const key = tagKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNames.push(name);
  }

  if (uniqueNames.length === 0) {
    return { tagIdByKey: new Map(), skippedNames: [] };
  }

  const tagIdByKey = await findTagIdsByName(supabase, accountId, uniqueNames);

  const skippedNames: string[] = [];
  const toCreate: string[] = [];

  for (const name of uniqueNames) {
    const key = tagKey(name);
    if (tagIdByKey.has(key)) continue;
    if (canCreateTags) toCreate.push(name);
    else skippedNames.push(name);
  }

  if (toCreate.length > 0) {
    const { data: created, error: createError } = await supabase
      .from('tags')
      .insert(
        toCreate.map((name) => ({
          user_id: userId,
          account_id: accountId,
          name,
          color: defaultColor,
        }))
      )
      .select('id, name');

    if (createError) throw createError;

    const canonical = await findTagIdsByName(supabase, accountId, toCreate);
    const supersededTags: SupersededTag[] = [];
    for (const tag of created ?? []) {
      const key = tagKey(tag.name);
      const winnerId = canonical.get(key);
      if (!winnerId) {
        tagIdByKey.set(key, tag.id);
      } else {
        tagIdByKey.set(key, winnerId);
        if (winnerId !== tag.id) {
          supersededTags.push({ loserId: tag.id, winnerId });
        }
      }
    }

    for (const superseded of supersededTags) {
      await retireSupersededTag(supabase, accountId, superseded);
    }
  }

  return { tagIdByKey, skippedNames };
}

export interface ContactTagAssignment {
  contactId: string;
  tagNames: string[];
}

/**
 * Insert contact_tags rows for imported contacts (ignores duplicates).
 *
 * Returns the number of contact–tag pairs *requested* for upsert, not
 * rows actually inserted — `ignoreDuplicates` can drop pairs that already
 * exist without changing the returned count.
 */
export async function assignImportedContactTags(
  supabase: SupabaseClient,
  assignments: ContactTagAssignment[],
  tagIdByKey: Map<string, string>
): Promise<number> {
  const rows: { contact_id: string; tag_id: string }[] = [];

  for (const { contactId, tagNames } of assignments) {
    const assignedTagIds = new Set<string>();
    for (const name of tagNames) {
      const tagId = tagIdByKey.get(name.trim().toLowerCase());
      if (!tagId || assignedTagIds.has(tagId)) continue;
      assignedTagIds.add(tagId);
      rows.push({ contact_id: contactId, tag_id: tagId });
    }
  }

  if (rows.length === 0) return 0;

  const chunkSize = 100;
  let assigned = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from('contact_tags').upsert(chunk, {
      onConflict: 'contact_id,tag_id',
      ignoreDuplicates: true,
    });
    if (error) throw error;
    assigned += chunk.length;
  }

  return assigned;
}
