import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { fetchLinkPreview } from "@/lib/link-preview/fetch-preview";

// GET /api/link-preview?url=<url> — resolves OG-style metadata for a link
// pasted into a chat message (see MessageBubble/LinkPreviewCard). Requires
// a signed-in session (any account role) purely so this can't become an
// open, internet-wide SSRF-probing proxy for anonymous callers — it
// doesn't read or scope by account_id, the same metadata is valid for
// anyone who asks. Not under /api/whatsapp/*, so the session-auth
// middleware trap for that prefix doesn't apply here; auth is enforced
// explicitly below instead, same pattern as /api/quick-replies.
export async function GET(request: Request) {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  const result = await fetchLinkPreview(url);
  if (result.status === "error") {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result.data);
}
