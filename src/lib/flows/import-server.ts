/**
 * Server-side half of flow import: resolves tag names, inserts the
 * flow + nodes with the service-role client, and runs the activation
 * validator so the caller can show what still needs fixing.
 *
 * Shared by the dashboard route (POST /api/flows/import) and the public
 * API (POST /api/v1/flows). Callers are responsible for authN/authZ and
 * pass in the already-resolved account + author.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  applyTagIds,
  collectTagNames,
  type PortableFlow,
} from "./import";
import { validateFlowForActivation, type ValidationIssue } from "./validate";

export class FlowImportError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "FlowImportError";
    this.status = status;
  }
}

const DEFAULT_TAG_COLOR = "#3b82f6";

export async function resolveTags(
  admin: SupabaseClient,
  accountId: string,
  authorId: string,
  names: string[],
  canCreate: boolean,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (names.length === 0) return map;

  const { data: existing, error } = await admin
    .from("tags")
    .select("id, name")
    .eq("account_id", accountId);
  if (error) throw new FlowImportError(error.message, 500);

  const byLower = new Map<string, { id: string; name: string }>();
  for (const t of (existing ?? []) as Array<{ id: string; name: string }>) {
    byLower.set(t.name.trim().toLowerCase(), t);
  }

  const missing: string[] = [];
  for (const name of names) {
    const hit = byLower.get(name.toLowerCase());
    if (hit) map.set(name, hit.id);
    else missing.push(name);
  }

  if (missing.length > 0) {
    if (!canCreate) {
      throw new FlowImportError(
        `These tags do not exist and only an admin can create them: ${missing.join(", ")}. ` +
          "Ask an admin to import this flow, or create the tags in Settings → Fields & tags first.",
        403,
      );
    }
    const { data: created, error: insErr } = await admin
      .from("tags")
      .insert(
        missing.map((name) => ({
          account_id: accountId,
          user_id: authorId,
          name,
          color: DEFAULT_TAG_COLOR,
        })),
      )
      .select("id, name");
    if (insErr) throw new FlowImportError(insErr.message, 500);
    for (const t of (created ?? []) as Array<{ id: string; name: string }>) {
      map.set(t.name, t.id);
    }
  }
  return map;
}

export async function createFlowFromImport(
  admin: SupabaseClient,
  opts: {
    accountId: string;
    authorId: string;
    flow: PortableFlow;
    /** Name override (e.g. `?name=` on the API). */
    name?: string;
    canCreateTags: boolean;
  },
): Promise<{ flow: Record<string, unknown>; issues: ValidationIssue[] }> {
  const { accountId, authorId, flow, canCreateTags } = opts;

  const tagIds = await resolveTags(
    admin,
    accountId,
    authorId,
    collectTagNames(flow.nodes),
    canCreateTags,
  );
  const nodes = applyTagIds(flow.nodes, tagIds);

  const { data: row, error: flowErr } = await admin
    .from("flows")
    .insert({
      user_id: authorId,
      account_id: accountId,
      name: opts.name?.trim() || flow.name,
      description: flow.description,
      // Always lands as a draft — activation is a deliberate second step
      // so a bad import can never start talking to customers by itself.
      status: "draft",
      trigger_type: flow.trigger_type,
      trigger_config: flow.trigger_config,
      entry_node_id: flow.entry_node_id,
      fallback_policy: flow.fallback_policy,
    })
    .select()
    .single();
  if (flowErr || !row) {
    throw new FlowImportError(flowErr?.message ?? "flow insert failed", 500);
  }

  const { error: nodesErr } = await admin.from("flow_nodes").insert(
    nodes.map((n) => ({
      flow_id: row.id,
      node_key: n.node_key,
      node_type: n.node_type,
      config: n.config,
      position_x: n.position_x,
      position_y: n.position_y,
    })),
  );
  if (nodesErr) {
    // Don't leave an empty draft behind (CASCADE clears any nodes).
    await admin.from("flows").delete().eq("id", row.id);
    throw new FlowImportError(nodesErr.message, 500);
  }

  const issues = validateFlowForActivation(
    {
      name: row.name as string,
      trigger_type: flow.trigger_type,
      trigger_config: flow.trigger_config,
      entry_node_id: flow.entry_node_id,
    },
    nodes,
  );
  return { flow: row as Record<string, unknown>, issues };
}

/** account_id → owner's user id; used as the author for API-key imports
 *  when the key's creator has since been removed. */
export async function resolveAuthorId(
  admin: SupabaseClient,
  accountId: string,
  preferred: string | null,
): Promise<string> {
  if (preferred) return preferred;
  const { data } = await admin
    .from("accounts")
    .select("owner_user_id")
    .eq("id", accountId)
    .maybeSingle();
  const owner = (data as { owner_user_id?: string } | null)?.owner_user_id;
  if (!owner) throw new FlowImportError("Account has no owner to attribute the flow to.", 500);
  return owner;
}

export async function loadFlowExport(
  admin: SupabaseClient,
  accountId: string,
  flowId: string,
) {
  const [{ data: flow }, { data: nodes }, { data: tags }] = await Promise.all([
    admin
      .from("flows")
      .select(
        "name, description, trigger_type, trigger_config, fallback_policy, entry_node_id",
      )
      .eq("id", flowId)
      .eq("account_id", accountId)
      .maybeSingle(),
    admin
      .from("flow_nodes")
      .select("node_key, node_type, config, position_x, position_y")
      .eq("flow_id", flowId)
      .order("created_at", { ascending: true }),
    admin.from("tags").select("id, name").eq("account_id", accountId),
  ]);
  if (!flow) return null;
  return {
    flow: flow as Parameters<typeof import("./import").buildFlowExport>[0],
    nodes: (nodes ?? []) as Parameters<typeof import("./import").buildFlowExport>[1],
    tagNameById: new Map(
      ((tags ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
    ),
  };
}
