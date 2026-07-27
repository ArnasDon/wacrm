import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import type { FlowNodeRow, FlowRow } from "@/lib/flows/types";
import { validateFlowForActivation } from "@/lib/flows/validate";
import {
  buildFlowVersionGraph,
  getFlowEntryTrigger,
  type FlowVersionGraph,
} from "@/lib/flows/versions";
import { resolveSubFlowPinsForPublish } from "@/lib/flows/sub-flow-pins";
import { nextCronOccurrence } from "@/lib/flows/trigger-scheduler";
import { createClient } from "@/lib/supabase/server";

function buildPublishedSchedule(
  draft: FlowRow,
  graph: FlowVersionGraph,
  now: Date,
):
  | {
      account_id: string;
      flow_id: string;
      trigger_node_key: string;
      cron_expr: string;
      timezone: string;
      misfire_policy: "skip" | "fire_once";
      status: "active";
      next_fire_at: string;
    }
  | null {
  const trigger = getFlowEntryTrigger(graph);
  if (trigger.type !== "time") return null;
  const cronExpr =
    typeof trigger.config.cron === "string"
      ? trigger.config.cron.trim()
      : typeof trigger.config.schedule === "string"
        ? trigger.config.schedule.trim()
        : "";
  if (!cronExpr) {
    throw new Error("time trigger cron expression is required");
  }
  const timezone =
    typeof trigger.config.timezone === "string" &&
    trigger.config.timezone.trim()
      ? trigger.config.timezone.trim()
      : "UTC";
  const misfirePolicy =
    trigger.config.misfire_policy === "fire_once" ? "fire_once" : "skip";
  return {
    account_id: draft.account_id,
    flow_id: draft.id,
    trigger_node_key: trigger.node_key,
    cron_expr: cronExpr,
    timezone,
    misfire_policy: misfirePolicy,
    status: "active",
    next_fire_at: nextCronOccurrence(cronExpr, timezone, now).toISOString(),
  };
}

async function ownerContext(
  flowId: string,
): Promise<
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      user: { id: string };
    }
  | { ok: false; error: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const { data: flow } = await supabase
    .from("flows")
    .select("id, user_id")
    .eq("id", flowId)
    .maybeSingle();
  if (!flow) {
    return {
      ok: false,
      error: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  if (flow.user_id !== user.id) {
    return {
      ok: false,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, supabase, user };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const owner = await ownerContext(id);
  if (!owner.ok) return owner.error;

  const { data, error } = await owner.supabase
    .from("flow_versions")
    .select("id, flow_id, version, published_at, published_by, label")
    .eq("flow_id", id)
    .order("version", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ versions: data ?? [] });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    await requireRole("agent");
  } catch (error) {
    return toErrorResponse(error);
  }

  const owner = await ownerContext(id);
  if (!owner.ok) return owner.error;
  const body = (await request.json().catch(() => null)) as
    | { label?: unknown }
    | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    body.label !== undefined &&
    body.label !== null &&
    typeof body.label !== "string"
  ) {
    return NextResponse.json({ error: "label must be a string" }, { status: 400 });
  }
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim()
      : null;
  if (label && label.length > 120) {
    return NextResponse.json(
      { error: "label must be at most 120 characters" },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: draftRead, error: draftReadError } = await admin.rpc(
    "read_flow_draft_for_publish",
    { p_flow_id: id },
  );
  if (draftReadError) {
    return NextResponse.json(
      { error: draftReadError.message },
      { status: draftReadError.message.includes("flow not found") ? 404 : 500 },
    );
  }
  const consistentDraft = Array.isArray(draftRead)
    ? draftRead[0]
    : draftRead;
  if (!consistentDraft?.flow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const draft = consistentDraft.flow as FlowRow;
  const draftNodes = (consistentDraft.nodes ?? []) as FlowNodeRow[];
  const issues = validateFlowForActivation(
    {
      name: draft.name,
      trigger_type: draft.trigger_type,
      trigger_config: draft.trigger_config as Record<string, unknown>,
      entry_node_id: draft.entry_node_id,
      fallback_policy: draft.fallback_policy,
      variable_schema: draft.variable_schema,
    },
    draftNodes,
  );
  if (issues.some((issue) => issue.severity === "error")) {
    return NextResponse.json(
      {
        error: "Cannot publish flow — fix the issues below first.",
        issues,
      },
      { status: 422 },
    );
  }

  let graph;
  let scheduleRegistration: ReturnType<typeof buildPublishedSchedule> = null;
  const now = new Date();
  try {
    const pinnedNodes = await resolveSubFlowPinsForPublish(
      admin,
      draft.account_id,
      draft.id,
      draftNodes,
      draft.variable_schema,
    );
    graph = buildFlowVersionGraph(draft, pinnedNodes);
    scheduleRegistration = buildPublishedSchedule(draft, graph, now);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid flow draft",
      },
      { status: 422 },
    );
  }
  const { data: published, error: publishError } = await admin.rpc(
    "publish_flow_version",
    {
      p_flow_id: id,
      p_graph: graph,
      p_published_by: owner.user.id,
      p_expected_draft_revision: draft.draft_revision,
      p_label: label,
    },
  );
  if (publishError) {
    if (publishError.message.includes("draft_revision_conflict")) {
      return NextResponse.json(
        { error: "Draft changed during publication. Refresh and retry." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: publishError.message }, { status: 500 });
  }
  const version = Array.isArray(published) ? published[0] : published;
  if (!version?.id) {
    return NextResponse.json(
      { error: "Published version was not returned" },
      { status: 500 },
    );
  }
  if (scheduleRegistration) {
    const { error: scheduleError } = await admin
      .from("flow_trigger_schedules")
      .upsert(
        {
          ...scheduleRegistration,
          flow_version_id: version.id,
        },
        { onConflict: "flow_id,trigger_node_key" },
      );
    if (scheduleError) {
      return NextResponse.json({ error: scheduleError.message }, { status: 500 });
    }
  } else {
    const { error: scheduleError } = await admin
      .from("flow_trigger_schedules")
      .update({ status: "revoked", updated_at: now.toISOString() })
      .eq("flow_id", id)
      .eq("status", "active");
    if (scheduleError) {
      return NextResponse.json({ error: scheduleError.message }, { status: 500 });
    }
  }
  const { data: updated, error: updatedError } = await admin
    .from("flows")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (updatedError) {
    return NextResponse.json({ error: updatedError.message }, { status: 500 });
  }
  return NextResponse.json({ version, flow: updated }, { status: 201 });
}
