import type { SupabaseClient } from "@supabase/supabase-js";
import type { Contact } from "@/types";
import { CONTACT_PICKER_LIMIT } from "@/lib/contacts/contact-picker";
import { contactSearchFilter } from "@/lib/contacts/search-filter";

export type NewConversationContact = Pick<
  Contact,
  "id" | "name" | "phone" | "wa_username" | "wa_user_id" | "avatar_url"
>;

const NEW_CONVERSATION_CONTACT_COLUMNS =
  "id, name, phone, wa_username, wa_user_id, avatar_url";

export async function searchNewConversationContacts(
  db: SupabaseClient,
  accountId: string,
  rawSearch: string,
): Promise<NewConversationContact[]> {
  let query = db
    .from("contacts")
    .select(NEW_CONVERSATION_CONTACT_COLUMNS)
    .eq("account_id", accountId)
    .order("name")
    .limit(CONTACT_PICKER_LIMIT);
  const filter = contactSearchFilter(rawSearch);
  if (filter) query = query.or(filter);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as NewConversationContact[];
}

export async function findContactConversationId(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("conversations")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.id as string | undefined) ?? null;
}
