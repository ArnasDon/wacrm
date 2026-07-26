import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { commitFlowCode } from "../../import/commit";
import { readFlowCodeRequest } from "../../import/request";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let account;
  try {
    account = await requireRole("agent");
  } catch (error) {
    return toErrorResponse(error);
  }
  const body = await readFlowCodeRequest(request, "replace");
  if (!body.ok) {
    return NextResponse.json({ code: body.code }, { status: body.status });
  }
  return commitFlowCode({
    admin: supabaseAdmin(),
    actorId: account.userId,
    accountId: account.accountId,
    flowId: id,
    expectedDraftRevision: body.expectedDraftRevision,
    document: body.document,
    previewDigest: body.previewDigest!,
    resourceBindings: body.resourceBindings,
    secretBindings: body.secretBindings,
  });
}
