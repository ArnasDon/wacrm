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
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 2 * 1024 * 1024) {
    return NextResponse.json(
      { code: "INVALID_SECRET_SIDECAR" },
      { status: 413 },
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
