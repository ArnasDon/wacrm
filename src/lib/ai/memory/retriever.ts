import { supabaseAdmin } from "@/lib/automations/admin-client";

export interface RetrievedMemory {
  summary: string;
  summaryHash: string;
  memoryVersion: number;
  lastUpdatedBy: string;
}

export async function getHotMemory(
  contactId: string,
): Promise<RetrievedMemory | null> {

  const db = supabaseAdmin();

  const { data } = await db
    .from("ai_memory_hot")
    .select(`
      summary,
      summary_hash,
      memory_version,
      last_updated_by
    `)
    .eq("contact_id", contactId)
    .eq("archived", false)
    .maybeSingle();

  if (!data) {
    return null;
  }

  return {
    summary: data.summary,
    summaryHash: data.summary_hash,
    memoryVersion: data.memory_version,
    lastUpdatedBy: data.last_updated_by,
  };
}