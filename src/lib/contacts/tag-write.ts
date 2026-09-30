import type { SupabaseClient } from '@supabase/supabase-js';

export class ContactTagWriteError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ContactTagWriteError';
    this.status = status;
  }
}

interface ContactTagWriteInput {
  accountId: string;
  contactId: string;
  tagId: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveTagId(
  db: SupabaseClient,
  accountId: string,
  rawTagId: string,
  createIfMissing = false,
  contactId?: string
): Promise<string> {
  const cleaned = rawTagId?.trim();
  if (!cleaned) {
    throw new ContactTagWriteError('Tag not found', 404);
  }

  // 1. If it's a valid UUID, look up by id first
  if (UUID_REGEX.test(cleaned)) {
    const { data: tag, error } = await db
      .from('tags')
      .select('id')
      .eq('id', cleaned)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!error && tag) {
      return tag.id;
    }
  }

  // 2. Resolve by tag name (case-insensitive)
  const { data: tagByName, error: nameError } = await db
    .from('tags')
    .select('id')
    .ilike('name', cleaned)
    .eq('account_id', accountId)
    .maybeSingle();

  if (!nameError && tagByName) {
    return tagByName.id;
  }

  // 3. If allowed to create when missing (e.g. adding a new tag by name)
  if (createIfMissing) {
    // tags table requires a NOT NULL user_id FK (auth.users)
    let ownerUserId: string | null = null;

    const { data: profile } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .limit(1)
      .maybeSingle();

    if (profile?.user_id) {
      ownerUserId = profile.user_id;
    } else if (contactId) {
      const { data: contactRow } = await db
        .from('contacts')
        .select('user_id')
        .eq('id', contactId)
        .maybeSingle();
      if (contactRow?.user_id) {
        ownerUserId = contactRow.user_id;
      }
    }

    if (ownerUserId) {
      const { data: newTag, error: createError } = await db
        .from('tags')
        .insert({
          user_id: ownerUserId,
          account_id: accountId,
          name: cleaned,
          color: '#10B981', // pleasant emerald green default
        })
        .select('id')
        .maybeSingle();

      if (!createError && newTag) {
        return newTag.id;
      }
    }
  }

  throw new ContactTagWriteError('Tag not found', 404);
}

async function assertContactAndTagOwnership(
  db: SupabaseClient,
  input: ContactTagWriteInput,
  createIfMissing = false
): Promise<string> {
  const contactPromise = db
    .from('contacts')
    .select('id')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle();

  const [contactResult, resolvedTagId] = await Promise.all([
    contactPromise,
    resolveTagId(
      db,
      input.accountId,
      input.tagId,
      createIfMissing,
      input.contactId
    ),
  ]);

  if (contactResult.error) {
    throw new ContactTagWriteError('Could not verify contact ownership');
  }
  if (!contactResult.data) {
    throw new ContactTagWriteError('Contact not found', 404);
  }

  return resolvedTagId;
}

/**
 * Add a tag exactly once. The unique constraint on
 * (contact_id, tag_id) is the concurrency-safe source of truth: a
 * duplicate insert is a no-op and must not emit a tag_added event.
 */
export async function addContactTagIfAbsent(
  db: SupabaseClient,
  input: ContactTagWriteInput
): Promise<boolean> {
  const resolvedTagId = await assertContactAndTagOwnership(db, input, true);

  const { error } = await db
    .from('contact_tags')
    .insert({ contact_id: input.contactId, tag_id: resolvedTagId })
    .select('id')
    .maybeSingle();

  if (error?.code === '23505') return false;
  if (error) {
    throw new ContactTagWriteError(
      `Failed to add contact tag: ${error.message}`
    );
  }
  return true;
}

export async function removeContactTag(
  db: SupabaseClient,
  input: ContactTagWriteInput
): Promise<void> {
  const resolvedTagId = await assertContactAndTagOwnership(db, input, false);

  const { error } = await db
    .from('contact_tags')
    .delete()
    .eq('contact_id', input.contactId)
    .eq('tag_id', resolvedTagId);

  if (error) {
    throw new ContactTagWriteError(
      `Failed to remove contact tag: ${error.message}`
    );
  }
}
