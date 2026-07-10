import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getFlowTemplate } from "@/lib/flows/templates";

const DEFAULT_FLOW = "lead_capture";

export async function ensureDefaultFlows(
  accountId: string,
  userId: string,
) {
  const db = supabaseAdmin();

  console.log("[BOOTSTRAP] ensureDefaultFlows START", accountId);

  const template = getFlowTemplate(DEFAULT_FLOW);

  if (!template) {
  console.error("[BOOTSTRAP] Flow template not found:", DEFAULT_FLOW);
  return;
}

console.log("[BOOTSTRAP] Flow template:", template.name);

  const { data: existing } = await db
    .from("flows")
    .select("id")
    .eq("account_id", accountId)
    .eq("name", template.name)
    .maybeSingle();

  if (existing) {
  console.log("[BOOTSTRAP] Flow already exists:", template.name);
  return;
}

  const { data: flow, error } = await db
    .from("flows")
    .insert({
      account_id: accountId,
      user_id: userId,
      name: template.name,
      description: template.description,
      status: "draft",
      trigger_type: template.trigger_type,
      trigger_config: template.trigger_config,
      entry_node_id: template.entry_node_id,
    })
    .select()
    .single();

  if (error || !flow) {
  console.error("[BOOTSTRAP] Flow creation failed", error);
  throw new Error(error?.message ?? "Flow creation failed");
}

console.log("[BOOTSTRAP] Flow created:", flow.name);

  if (template.nodes.length > 0) {
    await db.from("flow_nodes").insert(
      template.nodes.map((n) => ({
        flow_id: flow.id,
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config,
      })),
    );
  }
}