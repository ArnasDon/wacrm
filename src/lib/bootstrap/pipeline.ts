import { supabaseAdmin } from "@/lib/automations/admin-client";

const DEFAULT_STAGES = [
  { name: "New Lead", color: "#3b82f6", position: 0 },
  { name: "Qualified", color: "#eab308", position: 1 },
  { name: "Proposal Sent", color: "#f97316", position: 2 },
  { name: "Negotiation", color: "#8b5cf6", position: 3 },
  { name: "Won", color: "#22c55e", position: 4 },
];

export async function ensureDefaultPipeline(
  accountId: string,
  userId: string,
) {
  const db = supabaseAdmin();

  // 1. Check existing pipeline
  const { data: existing } = await db
    .from("pipelines")
    .select("id")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  // 2. Create pipeline
  const { data: pipeline, error } = await db
    .from("pipelines")
    .insert({
      account_id: accountId,
      user_id: userId,
      name: "Sales Pipeline",
    })
    .select()
    .single();

  if (error || !pipeline) {
    throw new Error(error?.message ?? "Pipeline creation failed");
  }

  // 3. Create stages
  await db.from("pipeline_stages").insert(
    DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    })),
  );

  return pipeline.id;
}