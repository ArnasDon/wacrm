import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const MAX_DEBUG_REQUEST_BYTES = 64 * 1024;

export async function requireFlowDebugOwner(flowId: string): Promise<
  | {
      ok: true;
      user: { id: string };
      accountId: string;
      supabase: Awaited<ReturnType<typeof createClient>>;
    }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: debugJson({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const { data: flow } = await supabase
    .from("flows")
    .select("id, user_id, account_id")
    .eq("id", flowId)
    .maybeSingle();
  if (!flow || flow.user_id !== user.id) {
    return {
      ok: false,
      response: debugJson({ error: "Not found" }, { status: 404 }),
    };
  }
  return {
    ok: true,
    user,
    accountId: flow.account_id,
    supabase,
  };
}

export async function readDebugJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_DEBUG_REQUEST_BYTES
  ) {
    throw new Error("debug_request_too_large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_DEBUG_REQUEST_BYTES) {
    throw new Error("debug_request_too_large");
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("debug_invalid_json");
  }
}

export function debugJson(
  body: unknown,
  init?: { status?: number },
): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export function debugRpcError(error: { message?: string } | null): NextResponse {
  const message = error?.message ?? "Debug operation failed";
  if (message.includes("debug_revision_conflict")) {
    return debugJson(
      {
        code: "DEBUG_REVISION_CONFLICT",
        error: "The debug session changed. Reload and retry.",
      },
      { status: 409 },
    );
  }
  if (
    message.includes("not found") ||
    message.includes("expired") ||
    message.includes("closed")
  ) {
    return debugJson({ error: "Not found" }, { status: 404 });
  }
  return debugJson({ error: message }, { status: 500 });
}
