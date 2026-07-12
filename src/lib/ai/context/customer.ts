import { supabaseAdmin } from "@/lib/automations/admin-client";

export interface CustomerContext {
  id?: string;
  name?: string;
  phone?: string;
}

export async function getCustomerContext(
  contactId?: string,
): Promise<CustomerContext> {

  if (!contactId) {
    return {};
  }

  const db = supabaseAdmin();

  const { data } = await db
    .from("contacts")
    .select("id,name,phone")
    .eq("id", contactId)
    .maybeSingle();

  if (!data) {
    return {
      id: contactId,
    };
  }

  return {
    id: data.id,
    name: data.name ?? undefined,
    phone: data.phone ?? undefined,
  };
}