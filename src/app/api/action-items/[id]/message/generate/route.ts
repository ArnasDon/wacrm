import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { loadAiConfig } from "@/lib/ai/config";
import { generateFollowupFreeMessage } from "@/lib/ai/followup-message";
import { logAiUsage } from "@/lib/ai/usage";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST /api/action-items/[id]/message/generate  (agent+)
 *
 * Central de Ações' "sugerir mensagem" (AGENTS.md §25). Reuses the
 * exact same free-text drafting call the Central de IA's follow-up
 * flow uses (src/lib/ai/followup-message.ts) — no new AI logic, just a
 * different row to read reason/context from. Never sends anything;
 * the client hands the returned text to the existing
 * writeFollowupDraft() → /inbox?c= bridge when the user chooses to use it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, accountId, userId } = await requireRole("agent");

    const limit = checkRateLimit(`action-item-message-generate:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: item, error: fetchError } = await supabase
      .from("action_items")
      .select("id, title, description, conversation_id, contact:contacts(name)")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (fetchError) return bad("Failed to load action item", 500);
    if (!item) return bad("Not found", 404);
    if (!item.conversation_id) return bad("This action item has no conversation to draft for");

    const config = await loadAiConfig(supabase, accountId);
    if (!config) {
      return bad(
        "AI is not configured/active for this account yet — set it up in Settings > Agentes de IA",
        409,
      );
    }

    const contactName = (item.contact as { name?: string } | null)?.name || "Lead";

    const { text, usage } = await generateFollowupFreeMessage({
      db: supabase,
      config,
      conversationId: item.conversation_id,
      contactName,
      reason: item.title,
      approachSummary: item.description ?? null,
    });
    void logAiUsage(supabase, {
      accountId,
      conversationId: item.conversation_id,
      mode: "followup",
      provider: config.provider,
      model: config.model,
      usage,
    });

    return NextResponse.json({ text });
  } catch (err) {
    return toErrorResponse(err);
  }
}
