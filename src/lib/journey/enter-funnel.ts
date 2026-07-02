import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureFunnelStages } from "./funnel-stages";

/**
 * Drops a brand-new contact into the first funnel stage the moment
 * they send their first inbound message — the sales-funnel Kanban's
 * counterpart to the `new_contact_created` automation trigger. Called
 * from the WhatsApp and Uazapi webhooks right after `findOrCreateContact`
 * reports `wasCreated: true`; both webhooks already run against
 * `supabaseAdmin()`, so this bypasses RLS the same way the rest of the
 * inbound path does.
 *
 * Idempotent: does nothing if a journey row already exists for this
 * contact (defends against re-delivery/races on the same webhook
 * event; `contact_journey` has a UNIQUE (account_id, contact_id)).
 */
export async function enterFunnelIfNew(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<void> {
  const { data: existingJourney } = await db
    .from("contact_journey")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (existingJourney) return;

  const stages = await ensureFunnelStages(db, accountId);
  const firstStage = stages[0];
  if (!firstStage) return;

  const { data: journey, error } = await db
    .from("contact_journey")
    .insert({
      account_id: accountId,
      contact_id: contactId,
      stage_id: firstStage.id,
    })
    .select("id")
    .single();

  if (error || !journey) {
    // Unique violation means a concurrent delivery won the race — that
    // insert already logged its own transition, nothing left to do.
    if (error && error.code !== "23505") {
      console.error("[enter-funnel] failed to create contact_journey:", error.message);
    }
    return;
  }

  const { error: transitionError } = await db.from("contact_journey_transitions").insert({
    contact_journey_id: journey.id,
    account_id: accountId,
    from_stage_id: null,
    to_stage_id: firstStage.id,
  });
  if (transitionError) {
    console.error(
      "[enter-funnel] failed to log initial transition:",
      transitionError.message,
    );
  }
}
