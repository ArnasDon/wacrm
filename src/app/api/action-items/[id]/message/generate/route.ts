import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { loadAiConfig } from "@/lib/ai/config";
import { generateFollowupFreeMessage, selectFollowupTemplate } from "@/lib/ai/followup-message";
import { logAiUsage } from "@/lib/ai/usage";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST /api/action-items/[id]/message/generate  (agent+)
 *
 * Central de Ações' "Gerar mensagem por IA" for the Follow-up flow
 * (Pipeline → coluna Follow-up and Central de Ações → Follow-ups da
 * semana both open the same action_items row and call this same
 * endpoint — see action-item-detail-sheet.tsx). Zero new AI logic:
 * reuses the exact same two calls the Central de IA's follow-up block
 * (BLOCO 3/4) uses (src/lib/ai/followup-message.ts), just reading
 * reason/context off an `action_items` row instead of `ai_suggestions`.
 *
 * Template-first, matching the spec ("a IA deve adaptar um template
 * existente, não criar uma mensagem do zero"): tries
 * `selectFollowupTemplate` against the account's approved WhatsApp
 * templates first; only falls back to a free-style draft
 * (`generateFollowupFreeMessage`) when no approved template fits (or
 * none exist) — same fallback the Central de IA dialog already offers
 * manually via its "no_template" step, just automatic here since this
 * flow has no separate mode-choice screen.
 *
 * Never sends anything — the client reviews/edits the returned draft
 * and only sends via POST /api/whatsapp/send when the user clicks
 * "Enviar mensagem".
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
    const reason = item.title;
    const approachSummary = item.description ?? null;

    const { selection, usage: templateUsage } = await selectFollowupTemplate(
      supabase,
      accountId,
      config,
      { contactName, reason, approachSummary },
    );
    void logAiUsage(supabase, {
      accountId,
      conversationId: item.conversation_id,
      mode: "followup",
      provider: config.provider,
      model: config.model,
      usage: templateUsage,
    });

    if (selection) {
      return NextResponse.json({
        draft: {
          mode: "template" as const,
          template_id: selection.template.id,
          template_name: selection.template.name,
          template_language: selection.template.language,
          body_text: selection.template.body_text,
          values: selection.values,
        },
      });
    }

    // No approved template fit — fall back to a free-style draft so
    // the corretor still has something to review instead of a dead end.
    const { text, usage: freeUsage } = await generateFollowupFreeMessage({
      db: supabase,
      config,
      conversationId: item.conversation_id,
      contactName,
      reason,
      approachSummary,
    });
    void logAiUsage(supabase, {
      accountId,
      conversationId: item.conversation_id,
      mode: "followup",
      provider: config.provider,
      model: config.model,
      usage: freeUsage,
    });

    return NextResponse.json({ draft: { mode: "free" as const, text } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
