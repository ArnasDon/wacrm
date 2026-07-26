import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { createSecretSidecar } from "@/lib/flows/flow-code-sidecars";

export async function POST(request: Request) {
  let account;
  try {
    account = await requireRole("agent");
  } catch (error) {
    return toErrorResponse(error);
  }
  const contentLength = request.headers.get("content-length");
  if (!contentLength || !/^\d+$/.test(contentLength)) {
    return NextResponse.json(
      { code: "CONTENT_LENGTH_REQUIRED" },
      { status: 411 },
    );
  }
  const declared = Number(contentLength);
  if (declared < 1 || declared > 1024 * 1024) {
    return NextResponse.json(
      { code: "INVALID_SECRET_SIDECAR" },
      { status: 413 },
    );
  }
  const digest = request.headers.get("x-flow-code-digest") ?? "";
  const flowId = request.headers.get("x-flow-id") || undefined;
  if (
    !/^[a-f0-9]{64}$/.test(digest) ||
    (flowId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        flowId,
      ))
  ) {
    return NextResponse.json(
      { code: "INVALID_SECRET_SIDECAR" },
      { status: 400 },
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { code: "INVALID_SECRET_SIDECAR" },
      { status: 400 },
    );
  }
  const bindings: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value !== "string" || name in bindings) {
      return NextResponse.json(
        { code: "INVALID_SECRET_SIDECAR" },
        { status: 400 },
      );
    }
    bindings[name] = value;
  }
  try {
    const bindingToken = createSecretSidecar({
      actorId: account.userId,
      accountId: account.accountId,
      flowId,
      digest,
      bindings,
    });
    return NextResponse.json(
      { binding_token: bindingToken },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { code: "INVALID_SECRET_SIDECAR" },
      { status: 400 },
    );
  }
}
