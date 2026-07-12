import { NextResponse } from "next/server";
import { routeToAI } from "@/lib/ai/router";

export async function POST(request: Request) {
  const body = await request.json();

  const result = await routeToAI({
    message: body.message ?? "",
    accountId: body.accountId,
    contactId: body.contactId,
    conversationId: body.conversationId,
  });

  return NextResponse.json(result);
}