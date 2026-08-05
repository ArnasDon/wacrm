import { NextResponse, type NextRequest } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import {
  TelnyxApiError,
  createTelnyxClient,
  ensureWebrtcCredential,
  loadTelnyxApiKey,
} from "@/lib/telnyx/api"

// ============================================================
// POST /api/telnyx/token — login_token JWT para el softphone WebRTC
// (Fase 2, DAD §3 /token). Rol: agent.
//
// Telnyx emite el token (NO se firma localmente, policyjar
// telnyx-credentials.ts:116-123): POST /v2/telephony_credentials/{id}/token
// → { data: { token } } (JWT 24h, verificado context7).
//
// Devuelve además sip_username/sip_password para registro SIP opcional
// (mismo shape que policyjar /api/telnyx/token). Nunca se loguean.
// ============================================================

export const runtime = "nodejs"

export async function POST(_req: NextRequest) {
  try {
    const ctx = await requireRole("agent")

    // Credencial WebRTC (se crea automáticamente si falta).
    const credentialId = await ensureWebrtcCredential(ctx.accountId)
    const apiKey = await loadTelnyxApiKey(ctx.accountId)
    const client = createTelnyxClient(apiKey)

    const [{ token }, cred] = await Promise.all([
      client.createWebrtcToken(credentialId),
      client.getTelephonyCredential(credentialId),
    ])

    if (!token) {
      throw new TelnyxApiError("Telnyx returned an empty login token")
    }

    return NextResponse.json({
      token,
      credential_id: credentialId,
      sip_username: cred.sip_username ?? null,
      sip_password: cred.sip_password ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}