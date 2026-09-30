// ============================================================
// POST /api/partner-invitations/signup — public.
//
// Body: { token, firstName, lastName, password, confirmPassword? }
//
// Creates the SubUser. `role` and `parent_user_id` are NOT accepted
// from the client — a body carrying them (or any other owner/status
// field) is rejected with 400. Both values come from the invitation.
//
// Flow
//   1. Validate input + look up the invitation by token hash
//      (fast, friendly failures before anything is created).
//   2. Create the auth user through Supabase Auth (GoTrue owns
//      auth.users and hashes the password with bcrypt — the same
//      path as every other wacrm signup). Its `handle_new_user`
//      trigger creates the profile + a personal account.
//   3. `accept_partner_invitation` RPC — ONE database transaction:
//      lock + re-check invitation, duplicate-account check, set
//      role='SubUser' / parent_user_id / status='ACTIVE', name the
//      account after the company, mark the invitation ACCEPTED with
//      used_at, insert the Main User's notification. Any failure
//      rolls the whole transaction back.
//   4. If step 3 fails, the auth user from step 2 is deleted (with
//      its bootstrap account), so no partial SubUser survives.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import {
  hashPartnerToken,
  looksLikePartnerToken,
} from "@/lib/partners/invitations";
import {
  accountExistsForEmail,
  getClientIp,
  partnersDb,
} from "@/lib/partners/server";
import { describeFieldError, validatePartnerSignup } from "@/lib/partners/validation";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

// Privilege fields a client must never be able to set at signup.
const FORBIDDEN_FIELDS = [
  "role",
  "parent_user_id",
  "parentUserId",
  "status",
  "userId",
  "ownerId",
  "email",
] as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function rpcErrorResponse(err: PostgrestError): NextResponse {
  switch (err.message) {
    case "invitation_not_found":
      return json({ error: "This invitation link is invalid.", state: "invalid" }, 404);
    case "invitation_expired":
      return json({ error: "This invitation has expired.", state: "expired" }, 410);
    case "invitation_used":
      return json({ error: "This invitation has already been used.", state: "used" }, 409);
    case "invitation_revoked":
      return json({ error: "This invitation is no longer valid.", state: "revoked" }, 410);
    case "account_exists":
      return json(
        { error: "An account with this email already exists.", state: "account_exists" },
        409,
      );
  }
  console.error("[partner signup] accept_partner_invitation failed:", err);
  return json({ error: "Could not complete signup. Please try again." }, 500);
}

export async function POST(request: Request) {
  const limit = checkRateLimit(
    `partnerSignup:${getClientIp(request)}`,
    RATE_LIMITS.invitationRedeem,
  );
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return json({ error: "Invalid request body" }, 400);
  }
  const forbidden = FORBIDDEN_FIELDS.find((f) => f in body);
  if (forbidden) {
    return json({ error: `'${forbidden}' cannot be set during signup` }, 400);
  }

  const token = body.token;
  if (!looksLikePartnerToken(token)) {
    return json({ error: "This invitation link is invalid.", state: "invalid" }, 404);
  }

  const parsed = validatePartnerSignup(body);
  if (!parsed.ok) {
    const [field, code] = Object.entries(parsed.errors)[0];
    return json({ error: describeFieldError(field, code!), fields: parsed.errors }, 400);
  }
  const { firstName, lastName, password } = parsed.value;
  const tokenHash = hashPartnerToken(token);
  const db = partnersDb();

  try {
    // ---- 1. Pre-flight (the RPC re-checks all of this under lock) ----
    const { data: inv, error: invErr } = await db
      .from("partner_invitations")
      .select("id, email, company_name, status, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (invErr) throw invErr;
    if (!inv) return json({ error: "This invitation link is invalid.", state: "invalid" }, 404);
    if (inv.status === "ACCEPTED") {
      return json({ error: "This invitation has already been used.", state: "used" }, 409);
    }
    if (inv.status === "REVOKED") {
      return json({ error: "This invitation is no longer valid.", state: "revoked" }, 410);
    }
    if (inv.status === "EXPIRED" || new Date(inv.expires_at as string).getTime() <= Date.now()) {
      return json({ error: "This invitation has expired.", state: "expired" }, 410);
    }
    const email = inv.email as string;
    if (await accountExistsForEmail(db, email)) {
      return json(
        { error: "An account with this email already exists.", state: "account_exists" },
        409,
      );
    }

    // ---- 2. Create the auth user (bcrypt via Supabase Auth) ----
    const fullName = `${firstName} ${lastName}`;
    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email,
      password,
      // The invitee proved control of the address by opening the
      // emailed link, so no second confirmation round-trip.
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        company_name: inv.company_name,
      },
    });
    if (createErr || !created?.user) {
      const msg = createErr?.message?.toLowerCase() ?? "";
      if (msg.includes("already") && (msg.includes("registered") || msg.includes("exists"))) {
        return json(
          { error: "An account with this email already exists.", state: "account_exists" },
          409,
        );
      }
      if (createErr?.code === "weak_password" || msg.includes("password")) {
        return json({ error: createErr!.message, fields: { password: "weak" } }, 400);
      }
      console.error("[partner signup] createUser failed:", createErr);
      return json({ error: "Could not create your account. Please try again." }, 500);
    }
    const newUserId = created.user.id;

    // ---- 3. The signup transaction ----
    const { error: rpcErr } = await db.rpc("accept_partner_invitation", {
      p_token_hash: tokenHash,
      p_user_id: newUserId,
      p_first_name: firstName,
      p_last_name: lastName,
    });

    if (rpcErr) {
      // ---- 4. Compensate: remove the half-created user ----
      await discardUser(newUserId);
      return rpcErrorResponse(rpcErr);
    }

    return json({ ok: true, email }, 201);
  } catch (err) {
    console.error("[partner signup] unexpected error:", err);
    return json({ error: "Could not complete signup. Please try again." }, 500);
  }
}

/**
 * Delete an auth user created moments ago whose signup transaction
 * failed. The bootstrap account must go first: `accounts.owner_user_id`
 * is ON DELETE RESTRICT, and deleting the account cascades to the
 * (still empty) profile.
 */
async function discardUser(userId: string): Promise<void> {
  const db = partnersDb();
  const { error: acctErr } = await db.from("accounts").delete().eq("owner_user_id", userId);
  if (acctErr) console.error("[partner signup] cleanup: account delete failed:", acctErr);
  const { error: userErr } = await db.auth.admin.deleteUser(userId);
  if (userErr) console.error("[partner signup] cleanup: auth user delete failed:", userErr);
}
