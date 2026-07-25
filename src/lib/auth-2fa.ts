import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { sendLoginOtpEmail, smtpErrorMessage } from "@/lib/auth-mail";
import { query } from "@/lib/mysql";

const JWT_SECRET =
  process.env.ENCRYPTION_KEY ||
  "VedMint Crm-secret-default-encryption-key-32-chars";

const OTP_TTL_SECONDS = 10 * 60;
const OTP_MAX_ATTEMPTS = 5;
const CHALLENGE_TTL = "10m";

export function isTwoFactorEnabledFlag(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

export function createTwoFactorChallengeToken(
  userId: string,
  email: string,
): string {
  return jwt.sign(
    { userId, email, type: "login-2fa" },
    JWT_SECRET,
    { expiresIn: CHALLENGE_TTL },
  );
}

export function verifyTwoFactorChallengeToken(
  token: string,
): { userId: string; email: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      userId?: string;
      email?: string;
      type?: string;
    };
    if (
      payload.type !== "login-2fa" ||
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/** Create a fresh email OTP for login and send it. Returns challenge token. */
export async function issueLoginOtp(
  userId: string,
  email: string,
): Promise<{ challengeToken: string }> {
  const code = generateOtpCode();
  const codeHash = bcrypt.hashSync(code, 10);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  await query("DELETE FROM auth_login_otps WHERE user_id = ?", [userId]);
  await query(
    "INSERT INTO auth_login_otps (id, user_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, ?, 0)",
    [id, userId, codeHash, expiresAt],
  );

  await sendLoginOtpEmail(email, code);

  return {
    challengeToken: createTwoFactorChallengeToken(userId, email),
  };
}

export type VerifyLoginOtpResult =
  | { ok: true }
  | { ok: false; message: string; code?: string };

export async function verifyLoginOtp(
  userId: string,
  code: string,
): Promise<VerifyLoginOtpResult> {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return { ok: false, message: "Enter the 6-digit code from your email." };
  }

  const rows = await query<{
    id: string;
    code_hash: string;
    expires_at: Date | string;
    attempts: number;
  }>(
    "SELECT id, code_hash, expires_at, attempts FROM auth_login_otps WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId],
  );
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      message: "No verification code found. Please sign in again.",
      code: "OTP_MISSING",
    };
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await query("DELETE FROM auth_login_otps WHERE user_id = ?", [userId]);
    return {
      ok: false,
      message: "Too many incorrect attempts. Please sign in again.",
      code: "OTP_LOCKED",
    };
  }

  const expiresAt = new Date(row.expires_at).getTime();
  if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
    await query("DELETE FROM auth_login_otps WHERE user_id = ?", [userId]);
    return {
      ok: false,
      message: "This code has expired. Please sign in again.",
      code: "OTP_EXPIRED",
    };
  }

  if (!bcrypt.compareSync(trimmed, row.code_hash)) {
    await query(
      "UPDATE auth_login_otps SET attempts = attempts + 1 WHERE id = ?",
      [row.id],
    );
    return { ok: false, message: "Incorrect code. Please try again." };
  }

  await query("DELETE FROM auth_login_otps WHERE user_id = ?", [userId]);
  return { ok: true };
}

export function loginOtpEmailErrorMessage(err: unknown): string {
  return smtpErrorMessage(err).replace("reset email", "login code");
}
