import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { encrypt } from "@/lib/whatsapp/encryption";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function secret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

function endpointKey(): string {
  return `fw_${randomBytes(24).toString("base64url")}`;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEndpoint(row: Record<string, unknown>) {
  return {
    id: row.id,
    endpoint_key: row.endpoint_key,
    status: row.status,
    secret_fingerprint: row.secret_fingerprint,
    previous_secret_fingerprint: row.previous_secret_fingerprint,
    provisioned_at: row.provisioned_at,
    rotated_at: row.rotated_at,
    revoked_at: row.revoked_at,
  };
}

async function loadOwnedFlow(flowId: string, accountId: string) {
  const { data, error } = await supabaseAdmin()
    .from("flows")
    .select("id, account_id")
    .eq("id", flowId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; account_id: string } | null;
}

function parseBody(value: unknown): { trigger_node_key: string; rotate: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const trigger = typeof record.trigger_node_key === "string"
    ? record.trigger_node_key.trim()
    : "";
  if (!trigger) return null;
  return { trigger_node_key: trigger, rotate: record.rotate === true };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await context.params;
    const body = parseBody(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json(
        { error: "trigger_node_key is required" },
        { status: 400 },
      );
    }
    const flow = await loadOwnedFlow(id, ctx.accountId);
    if (!flow) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const plaintext = secret();
    const encrypted = encrypt(plaintext);
    const fp = fingerprint(plaintext);
    const admin = supabaseAdmin();

    if (body.rotate) {
      const { data: existing, error: existingError } = await admin
        .from("flow_webhook_endpoints")
        .select("id, secret_ciphertext, secret_fingerprint")
        .eq("flow_id", id)
        .eq("trigger_node_key", body.trigger_node_key)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const { data, error } = await admin
        .from("flow_webhook_endpoints")
        .update({
          status: "active",
          secret_ciphertext: encrypted,
          previous_secret_ciphertext: existing.secret_ciphertext,
          secret_fingerprint: fp,
          previous_secret_fingerprint: existing.secret_fingerprint,
          rotated_at: new Date().toISOString(),
          revoked_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("flow_id", id)
        .eq("trigger_node_key", body.trigger_node_key)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return NextResponse.json({ endpoint: safeEndpoint(data), secret: plaintext });
    }

    const { data, error } = await admin
      .from("flow_webhook_endpoints")
      .upsert(
        {
          account_id: ctx.accountId,
          flow_id: id,
          trigger_node_key: body.trigger_node_key,
          endpoint_key: endpointKey(),
          status: "active",
          secret_ciphertext: encrypted,
          previous_secret_ciphertext: null,
          secret_fingerprint: fp,
          previous_secret_fingerprint: null,
          provisioned_at: new Date().toISOString(),
          revoked_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "flow_id,trigger_node_key" },
      )
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ endpoint: safeEndpoint(data), secret: plaintext });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await context.params;
    const body = parseBody(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json(
        { error: "trigger_node_key is required" },
        { status: 400 },
      );
    }
    const flow = await loadOwnedFlow(id, ctx.accountId);
    if (!flow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { data, error } = await supabaseAdmin()
      .from("flow_webhook_endpoints")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("flow_id", id)
      .eq("trigger_node_key", body.trigger_node_key)
      .select("id, status")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      endpoint: { id: data.id, status: data.status },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
