// ============================================================
// /api/account/payments
//
//   GET  — payment webhook config for this account (any member):
//          webhook URL, secret display prefix, whether a secret is
//          configured. The plaintext secret is NEVER returned here.
//   POST — generate a fresh webhook secret (admin+). Mirrors the
//          api-keys one-time-reveal contract: the plaintext comes
//          back exactly ONCE in this response and is stored as
//          AES-256-GCM ciphertext, so a lost secret means
//          regenerate, not "show it again".
//
// The webhook URL is account-scoped via `?account_id=` so one
// deployment can run many accounts; a URL copied between accounts
// simply fails signature verification.
// ============================================================

import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import { getAbsoluteUrl } from "@/lib/app-url";
import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";

const SECRET_PREFIX = "sk_wacrm_";

function generateSecret(): { plaintext: string; prefix: string } {
  const plaintext = `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    plaintext,
    // Safe display fragment, e.g. "sk_wacrm_hX9pYq…".
    prefix: `${plaintext.slice(0, SECRET_PREFIX.length + 10)}…`,
  };
}

function buildWebhookUrl(accountId: string): string {
  return getAbsoluteUrl("/api/payments/webhook") + `?account_id=${accountId}`;
}

export async function GET() {
  let ctx: Awaited<ReturnType<typeof getCurrentAccount>>;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const { accountId } = ctx;

  const { data: settings, error } = await ctx.supabase
    .from("payment_settings")
    .select("webhook_secret_prefix, webhook_secret")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const hasSecret = Boolean(settings?.webhook_secret);

  return NextResponse.json({
    webhook_url: buildWebhookUrl(accountId),
    secret_prefix: settings?.webhook_secret_prefix ?? null,
    has_secret: hasSecret,
    base_url_configured: getAbsoluteUrl("").length > 0,
  });
}

export async function POST() {
  try {
    await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }

  const ctx = await getCurrentAccount();
  const { accountId, userId } = ctx;

  const { plaintext, prefix } = generateSecret();
  const ciphertext = encrypt(plaintext);

  const { error } = await ctx.supabase.from("payment_settings").upsert(
    {
      account_id: accountId,
      webhook_secret: ciphertext,
      webhook_secret_prefix: prefix,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    webhook_url: buildWebhookUrl(accountId),
    secret_prefix: prefix,
    // The ONLY time the plaintext leaves the server.
    plaintext,
  });
}
