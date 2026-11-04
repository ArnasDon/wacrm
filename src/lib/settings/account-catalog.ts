import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPages } from '@/lib/supabase/paged-query';
import type { MessageTemplate, Tag } from '@/types';

export function fetchAccountTemplates(
  db: SupabaseClient,
  accountId: string,
): Promise<MessageTemplate[]> {
  return fetchAllPages<MessageTemplate>((from, to) =>
    db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  );
}

export function fetchAccountTags(
  db: SupabaseClient,
  accountId: string,
): Promise<Tag[]> {
  return fetchAllPages<Tag>((from, to) =>
    db
      .from('tags')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .order('id')
      .range(from, to),
  );
}
