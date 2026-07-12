import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/automations/admin-client";

export interface SaveMemoryRequest {
  accountId: string;
  contactId: string;
  conversationId?: string;

  summary: string;

  lastMessageAt?: string;

  updatedBy?: string;
}

export async function saveHotMemory(
  request: SaveMemoryRequest,
): Promise<void> {

  const db = supabaseAdmin();

  const now = new Date();

  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 30);

  const summaryHash = createHash("sha256")
    .update(request.summary)
    .digest("hex");

  const { data, error } = await db
  .from("ai_memory_hot")
  .upsert(
    {
      account_id: request.accountId,

      contact_id: request.contactId,

      conversation_id:
        request.conversationId ?? null,

      summary: request.summary,

      summary_hash: summaryHash,

      memory_version: 1,

      last_updated_by:
        request.updatedBy ?? "ai",

      archived: false,

      last_message_at:
        request.lastMessageAt ??
        now.toISOString(),

      expires_at:
        expiresAt.toISOString(),

      updated_at:
        now.toISOString(),
    },
    {
      onConflict: "account_id,contact_id",
    },
  )
  .select();

console.log("[MEMORY UPSERT]", {
  data,
  error,
});

}