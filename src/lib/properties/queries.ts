import type { SupabaseClient } from '@supabase/supabase-js';
import type { Property } from '@/types';

type DB = SupabaseClient;

// ------------------------------------------------------------
// Properties (imóveis) — deliberately minimal (just a name) so an
// appointment can reference which listing it's about. Not a full
// listings module; add fields here if/when that's actually asked
// for, rather than guessing at a schema up front.
// ------------------------------------------------------------

export async function listProperties(db: DB): Promise<Property[]> {
  const { data, error } = await db.from('properties').select('*').order('name');
  if (error) throw error;
  return (data ?? []) as Property[];
}

export interface CreatePropertyInput {
  accountId: string;
  userId: string;
  name: string;
}

export async function createProperty(db: DB, input: CreatePropertyInput): Promise<Property> {
  const { data, error } = await db
    .from('properties')
    .insert({ account_id: input.accountId, user_id: input.userId, name: input.name })
    .select()
    .single();
  if (error) throw error;
  return data as Property;
}
