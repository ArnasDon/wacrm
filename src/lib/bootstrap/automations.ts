import { supabaseAdmin } from "@/lib/automations/admin-client";
import { getTemplate } from "@/lib/automations/templates";
import { insertSteps } from "@/lib/automations/steps-tree";

const DEFAULT_TEMPLATES = [
  "welcome_message",
  "lead_qualifier",
  "follow_up_reminder",
] as const;

export async function ensureDefaultAutomations(
  accountId: string,
  userId: string,
) {
  const db = supabaseAdmin();

  console.log("[BOOTSTRAP] ensureDefaultAutomations START", accountId);

  for (const slug of DEFAULT_TEMPLATES) {
    const template = getTemplate(slug);

    if (!template) continue;

    console.log("[BOOTSTRAP] Template", slug);

    const { data: existing } = await db
      .from("automations")
      .select("id")
      .eq("account_id", accountId)
      .eq("name", template.name)
      .maybeSingle();

      if (existing) {
  console.log("[BOOTSTRAP] Already exists", template.name);
  continue;
}

    const { data: automation, error } = await db
      .from("automations")
      .insert({
        account_id: accountId,
        user_id: userId,
        name: template.name,
        description: template.description,
        trigger_type: template.trigger_type,
        trigger_config: template.trigger_config,
        is_active: true,
      })
      .select()
      .single();

    if (error || !automation) {
      throw new Error(error?.message ?? "Failed to create automation");
    }

    console.log("[BOOTSTRAP] Created", automation.name);

    const err = await insertSteps(
      automation.id,
      template.steps as Parameters<typeof insertSteps>[1],
    );

    if (err) {
      throw new Error(err);
    }
  }
}
