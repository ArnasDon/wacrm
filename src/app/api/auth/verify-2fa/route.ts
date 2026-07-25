import { NextResponse } from "next/server";

import {
  issueLoginOtp,
  loginOtpEmailErrorMessage,
  verifyLoginOtp,
  verifyTwoFactorChallengeToken,
} from "@/lib/auth-2fa";
import {
  createVerifiedSessionToken,
  setSessionCookie,
} from "@/lib/auth-verification";
import { query } from "@/lib/mysql";
import {
  getVedmintConfig,
  issueVedmintToken,
  setVedmintApiTokenCookie,
} from "@/lib/vedmint-subscription/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const challengeToken =
      typeof body.challengeToken === "string" ? body.challengeToken : "";
    const code = typeof body.code === "string" ? body.code : "";

    if (!challengeToken || !code) {
      return NextResponse.json(
        { error: { message: "Verification code is required" } },
        { status: 400 },
      );
    }

    const challenge = verifyTwoFactorChallengeToken(challengeToken);
    if (!challenge) {
      return NextResponse.json(
        {
          error: {
            message: "This sign-in step expired. Please sign in again.",
            code: "CHALLENGE_EXPIRED",
          },
        },
        { status: 401 },
      );
    }

    const verified = await verifyLoginOtp(challenge.userId, code);
    if (!verified.ok) {
      return NextResponse.json(
        {
          error: {
            message: verified.message,
            code: verified.code ?? "OTP_INVALID",
          },
        },
        { status: 400 },
      );
    }

    const users = await query<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE id = ? LIMIT 1",
      [challenge.userId],
    );
    const dbUser = users[0];
    if (!dbUser) {
      return NextResponse.json(
        { error: { message: "User not found" } },
        { status: 404 },
      );
    }

    const token = createVerifiedSessionToken(dbUser.id, dbUser.email);
    const user = { id: dbUser.id, email: dbUser.email };
    const session = { user, access_token: token };
    const response = NextResponse.json({
      data: { user, session },
      error: null,
    });
    setSessionCookie(response, token);

    if (getVedmintConfig().configured) {
      try {
        const profiles = await query<{ full_name: string | null }>(
          "SELECT full_name FROM profiles WHERE user_id = ? LIMIT 1",
          [dbUser.id],
        );
        const issued = await issueVedmintToken({
          externalUserId: dbUser.id,
          email: dbUser.email,
          name: profiles[0]?.full_name,
        });
        setVedmintApiTokenCookie(response, issued.access_token);
      } catch (err) {
        console.error(
          "[POST /api/auth/verify-2fa] VedMint token issue failed:",
          err,
        );
      }
    }

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[POST /api/auth/verify-2fa] unexpected error:", err);
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}

/** Resend a login OTP using an existing challenge token. */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const challengeToken =
      typeof body.challengeToken === "string" ? body.challengeToken : "";

    if (!challengeToken) {
      return NextResponse.json(
        { error: { message: "Challenge token is required" } },
        { status: 400 },
      );
    }

    const challenge = verifyTwoFactorChallengeToken(challengeToken);
    if (!challenge) {
      return NextResponse.json(
        {
          error: {
            message: "This sign-in step expired. Please sign in again.",
            code: "CHALLENGE_EXPIRED",
          },
        },
        { status: 401 },
      );
    }

    try {
      const { challengeToken: nextToken } = await issueLoginOtp(
        challenge.userId,
        challenge.email,
      );
      return NextResponse.json({
        data: {
          needs2FA: true,
          challengeToken: nextToken,
          email: challenge.email,
        },
        error: null,
      });
    } catch (err) {
      console.error("[PUT /api/auth/verify-2fa] resend failed:", err);
      return NextResponse.json(
        { error: { message: loginOtpEmailErrorMessage(err) } },
        { status: 500 },
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("[PUT /api/auth/verify-2fa] unexpected error:", err);
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
