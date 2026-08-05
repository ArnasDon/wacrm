import { NextResponse, type NextRequest } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { supabaseAdmin } from "@/lib/telnyx/admin-client"

// ============================================================
// GET /api/telnyx/recordings/[callId] — proxy autenticado de grabaciones
// (Fase 2, DAD §2.4). Rol: agent.
//
// El bucket `call-recordings` es el ÚNICO privado del sistema: no hay
// getPublicUrl. La grabación se sirve solo aquí: se lee el path desde
// `calls.recording_storage_path`, se firma una URL de 5 min y se
// redirige (302). `calls.recording_url` guarda esta URL de proxy.
// ============================================================

export const runtime = "nodejs"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ callId: string }> },
) {
  try {
    const ctx = await requireRole("agent")
    const { callId } = await context.params

    const admin = supabaseAdmin()
    const { data: call } = await admin
      .from("calls")
      .select("recording_storage_path")
      .eq("id", callId)
      .eq("account_id", ctx.accountId)
      .maybeSingle()

    if (!call?.recording_storage_path) {
      return NextResponse.json({ error: "recording not found" }, { status: 404 })
    }

    // Expire 5 min (300s), como define el DAD.
    const { data: signed, error } = await admin.storage
      .from("call-recordings")
      .createSignedUrl(call.recording_storage_path, 300)

    if (error || !signed?.signedUrl) {
      return NextResponse.json({ error: "recording unavailable" }, { status: 500 })
    }

    return NextResponse.redirect(signed.signedUrl, 302)
  } catch (err) {
    return toErrorResponse(err)
  }
}
