import { supabaseAdmin } from "@/lib/automations/admin-client";

export async function getKnowledgeContext(
  accountId?: string,
): Promise<string[]> {

  if (!accountId) {
    return [];
  }

  const db = supabaseAdmin();

  const { data, error } = await db
    .from("ai_knowledge")
    .select("title, content")
    .eq("account_id", accountId)
    .eq("enabled", true)
    .order("priority", {
      ascending: false,
    })
    .limit(20);

  if (error || !data) {
    return [];
  }

  return data.map(
    (item) =>
      `${item.title}\n${item.content}`,
  );

}