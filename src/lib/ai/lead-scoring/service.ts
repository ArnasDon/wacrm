import { supabaseAdmin } from "@/lib/automations/admin-client";
import type { LeadScore } from "./types";
import { saveLeadScoreHistory } from "./history";

export async function saveLeadScore(
  score: LeadScore,
) {

  const db = supabaseAdmin();

  const { error } = await db
  .from("ai_lead_scores")
  .upsert(
    {
      account_id: score.accountId,
      contact_id: score.contactId,
      conversation_id: score.conversationId ?? null,

      ai_score: score.score,
      ai_grade: score.grade,
      ai_reason: score.reason,
      ai_confidence: score.confidence ?? null,

      last_intent: score.intent ?? null,

      effective_score: score.score,
      effective_grade: score.grade,

      pipeline_stage: score.pipeline,
      next_action: score.nextAction,

      updated_by_ai: true,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "account_id,contact_id",
    }
  );

if (error) {
  console.error("[AI LEAD SCORE ERROR]", error);
  return;
}

try {
  await saveLeadScoreHistory(score);
} catch (err) {
  console.error("[AI LEAD HISTORY ERROR]", err);
}
}