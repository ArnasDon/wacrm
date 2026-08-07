import type { SupabaseClient } from "@supabase/supabase-js";

interface EnsureDealParams {
  /** Service-role client — this runs from the inbound webhook, outside any user session. */
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  contactName: string;
  conversationId: string;
}

/**
 * Files a new lead into the account's pipeline the moment their first
 * conversation is created — the Pipeline board is the CRM's central view,
 * so a lead should never have to be added to it by hand.
 *
 * Targets whichever pipeline/stage the account already has configured
 * (oldest pipeline, lowest `position` stage) rather than any hardcoded
 * name, since stage names are user-configurable in Pipeline Settings.
 * No-ops silently if the account hasn't set up a pipeline yet — this is
 * a convenience, not a requirement to have Pipelines configured.
 *
 * Guards against duplicates by checking for an existing deal for this
 * contact in the pipeline first; a contact must never end up with two
 * cards. Not called on every inbound message — only when
 * findOrCreateConversation() actually created a new conversation row.
 */
export async function ensureDealForNewLead({
  db,
  accountId,
  userId,
  contactId,
  contactName,
  conversationId,
}: EnsureDealParams): Promise<void> {
  const { data: pipelines, error: pipelineError } = await db
    .from("pipelines")
    .select("id")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (pipelineError) {
    console.error("[auto-deal] failed to load pipeline:", pipelineError.message);
    return;
  }
  const pipelineId = pipelines?.[0]?.id;
  if (!pipelineId) return;

  const { data: firstStages, error: stageError } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true })
    .limit(1);
  if (stageError) {
    console.error("[auto-deal] failed to load first stage:", stageError.message);
    return;
  }
  const stageId = firstStages?.[0]?.id;
  if (!stageId) return;

  // Dedup guard: never let a contact end up with two cards in the same
  // pipeline. Not race-proof (no unique index backs this), but two
  // inbound deliveries racing to create the *same* brand-new contact's
  // *first* conversation is an edge case this app already tolerates
  // elsewhere (see findOrCreateContact/findOrCreateConversation).
  const { data: existingDeals, error: existingError } = await db
    .from("deals")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("contact_id", contactId)
    .limit(1);
  if (existingError) {
    console.error("[auto-deal] failed to check for existing deal:", existingError.message);
    return;
  }
  if (existingDeals && existingDeals.length > 0) return;

  const { data: accounts } = await db
    .from("accounts")
    .select("default_currency")
    .eq("id", accountId)
    .limit(1);

  const { error: insertError } = await db.from("deals").insert({
    account_id: accountId,
    user_id: userId,
    pipeline_id: pipelineId,
    stage_id: stageId,
    contact_id: contactId,
    conversation_id: conversationId,
    title: contactName,
    value: 0,
    currency: accounts?.[0]?.default_currency ?? "USD",
    status: "open",
  });
  if (insertError) {
    console.error("[auto-deal] failed to create deal for new lead:", insertError.message);
  }
}
