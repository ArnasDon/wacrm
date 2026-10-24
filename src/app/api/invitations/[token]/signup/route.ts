// ============================================================
// POST /api/invitations/[token]/signup
//
// Registro cerrado (BASE.3): Supabase Auth corre con
// GOTRUE_DISABLE_SIGNUP=true, así que /auth/v1/signup rechaza el
// autorregistro. La única vía de alta es esta ruta, que exige una
// invitación pendiente real (existe, no usada, no vencida), crea
// el usuario con la service role y canjea la invitación en el mismo
// paso (redeem_invitation_for_new_user, con la fila bloqueada). Un
// token da un solo alta. Después el cliente inicia sesión.
// ============================================================

import { NextResponse } from "next/server";

import { hashInviteToken } from "@/lib/auth/invitations";
import { supabaseAdmin } from "@/lib/ai/admin-client";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`invite-signup:${ip}`, RATE_LIMITS.invitationRedeem);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "invite_invalid" }, { status: 403 });
  }

  let body: { email?: unknown; password?: unknown; fullName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  if (!email || password.length < 6) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: peek, error: peekError } = await admin.rpc("peek_invitation", {
    p_token_hash: hashInviteToken(token),
  });
  if (peekError) {
    console.error("[invite-signup] peek error:", peekError);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (!peek?.ok) {
    return NextResponse.json(
      { error: "invite_invalid", reason: peek?.reason ?? "not_found" },
      { status: 403 },
    );
  }

  const tokenHash = hashInviteToken(token);
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !created?.user) {
    // No devolvemos el mensaje de Auth: evita enumerar emails registrados.
    console.error("[invite-signup] createUser error:", error?.message);
    return NextResponse.json({ error: "signup_failed" }, { status: 400 });
  }
  const userId = created.user.id;

  // Alta + canje en un solo paso: la función bloquea la invitación y la
  // marca usada. Si falla (p. ej. carrera con otro POST), se deshace el alta.
  const { error: redeemError } = await admin.rpc("redeem_invitation_for_new_user", {
    p_token_hash: tokenHash,
    p_user_id: userId,
  });
  if (redeemError) {
    console.error("[invite-signup] redeem error:", redeemError);
    // accounts.owner_user_id es RESTRICT: primero la cuenta personal, luego el usuario.
    await admin.from("accounts").delete().eq("owner_user_id", userId);
    await admin.auth.admin.deleteUser(userId);
    const invalid = redeemError.code === "22023";
    return NextResponse.json(
      { error: invalid ? "invite_invalid" : "server_error" },
      { status: invalid ? 403 : 500 },
    );
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
