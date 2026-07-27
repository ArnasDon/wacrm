import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { verifySignatureHeader } from "@/lib/webhooks/sign";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

interface RouteContext {
  params: Promise<{ endpointKey: string }>;
}

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function safeParseJson(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function verifiedByAnySecret(args: {
  header: string | null;
  rawBody: string;
  nowSeconds: number;
  ciphertexts: Array<string | null | undefined>;
}): boolean {
  for (const ciphertext of args.ciphertexts) {
    if (!ciphertext) continue;
    let secret: string;
    try {
      secret = decrypt(ciphertext);
    } catch {
      continue;
    }
    if (
      verifySignatureHeader(
        args.header ?? "",
        args.rawBody,
        secret,
        args.nowSeconds,
        300,
      )
    ) {
      return true;
    }
  }
  return false;
}

export async function POST(request: Request, context: RouteContext) {
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return json(400, { error: "Idempotency-Key header is required" });
  }
  if (idempotencyKey.length > 240) {
    return json(400, { error: "Idempotency-Key is too long" });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return json(413, { error: "Webhook body is too large" });
  }
  const payload = safeParseJson(rawBody);
  if (!payload) {
    return json(400, { error: "Webhook body must be a JSON object" });
  }

  const { endpointKey } = await context.params;
  const db = supabaseAdmin();
  const { data: endpoint, error } = await db
    .from("flow_webhook_endpoints")
    .select(
      "id, account_id, flow_id, trigger_node_key, status, secret_ciphertext, previous_secret_ciphertext",
    )
    .eq("endpoint_key", endpointKey)
    .eq("status", "active")
    .maybeSingle();
  if (error) {
    console.error("[flow-webhook] endpoint lookup failed");
    return json(500, { error: "Webhook unavailable" });
  }
  if (!endpoint) {
    return json(404, { error: "Webhook endpoint not found" });
  }

  const signature = request.headers.get("x-wacrm-signature");
  const verified = verifiedByAnySecret({
    header: signature,
    rawBody,
    nowSeconds: Math.floor(Date.now() / 1000),
    ciphertexts: [
      endpoint.secret_ciphertext as string | null,
      endpoint.previous_secret_ciphertext as string | null,
    ],
  });
  if (!verified) {
    return json(401, { error: "Invalid webhook signature" });
  }

  const { data: accepted, error: acceptError } = await db.rpc(
    "accept_flow_trigger_invocation",
    {
      p_account_id: endpoint.account_id,
      p_flow_id: endpoint.flow_id,
      p_trigger_node_key: endpoint.trigger_node_key,
      p_source: "webhook",
      p_idempotency_key: idempotencyKey,
      p_body_hash: createHash("sha256").update(rawBody).digest("hex"),
      p_payload: payload,
      p_variables: {},
      p_webhook_endpoint_id: endpoint.id,
      p_response_mode: "async",
    },
  );
  if (acceptError) {
    return json(409, { error: "Webhook idempotency conflict" });
  }
  const invocation = Array.isArray(accepted) ? accepted[0] : accepted;
  return json(202, {
    accepted: true,
    invocation_id: invocation?.id ?? null,
  });
}
