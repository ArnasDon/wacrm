import { supabaseAdmin } from "@/lib/automations/admin-client";
import type { LeadScore } from "./types";

export async function saveLeadScoreHistory(
  score: LeadScore,
) {

  const db = supabaseAdmin();

  await db
    .from("ai_lead_score_history")
    .insert({

      account_id: score.accountId,

      contact_id: score.contactId,

      conversation_id:
        score.conversationId ?? null,

      new_score: score.score,

      new_grade: score.grade,

      reason: score.reason,

      change_source: score.updatedBy,

    });

}