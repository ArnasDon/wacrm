import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { commitFlowCode } from "./commit";
import { readFlowCodeRequest } from "./request";

export async function POST(request: Request) {
  let account;
  try {
    account = await requireRole("agent");
  } catch (error) {
    return toErrorResponse(error);
  }
  const body = await readFlowCodeRequest(request, "create");
  if (!body.ok) {
    return NextResponse.json({ code: body.code }, { status: body.status });
  }
  return commitFlowCode({
    admin: supabaseAdmin(),
    actorId: account.userId,
    accountId: account.accountId,
    document: body.document,
    previewDigest: body.previewDigest!,
    resourceBindings: body.resourceBindings,
    secretBindings: body.secretBindings,
  });
}
