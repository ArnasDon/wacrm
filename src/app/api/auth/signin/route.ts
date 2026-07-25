import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { query } from '@/lib/mysql';
import {
  createVerifiedSessionToken,
  isEmailVerifiedFlag,
  sendUserVerificationEmail,
  setSessionCookie,
  verificationEmailErrorMessage,
} from '@/lib/auth-verification';
import {
  issueLoginOtp,
  isTwoFactorEnabledFlag,
  loginOtpEmailErrorMessage,
} from '@/lib/auth-2fa';
import { sessionUserFromRequest } from '@/lib/session-token';
import {
  getVedmintConfig,
  issueVedmintToken,
  setVedmintApiTokenCookie,
} from '@/lib/vedmint-subscription/server';

async function completeSignIn(
  dbUser: { id: string; email: string },
) {
  const token = createVerifiedSessionToken(dbUser.id, dbUser.email);
  const user = { id: dbUser.id, email: dbUser.email };
  const session = { user, access_token: token };

  const response = NextResponse.json({ data: { user, session }, error: null });
  setSessionCookie(response, token);

  if (getVedmintConfig().configured) {
    try {
      const profiles = await query<{ full_name: string | null }>(
        'SELECT full_name FROM profiles WHERE user_id = ? LIMIT 1',
        [dbUser.id],
      );
      const issued = await issueVedmintToken({
        externalUserId: dbUser.id,
        email: dbUser.email,
        name: profiles[0]?.full_name,
      });
      setVedmintApiTokenCookie(response, issued.access_token);
    } catch (err) {
      console.error('[POST /api/auth/signin] VedMint token issue failed:', err);
    }
  }

  return response;
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: { message: 'Email and password are required' } }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const dbUsers = await query<{
      id: string;
      email: string;
      password_hash: string;
      email_verified?: number | boolean;
      two_factor_enabled?: number | boolean;
    }>('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    const dbUser = dbUsers[0];

    if (!dbUser || !bcrypt.compareSync(password, dbUser.password_hash)) {
      return NextResponse.json({ error: { message: 'Invalid credentials' } }, { status: 400 });
    }

    if (!isEmailVerifiedFlag(dbUser.email_verified)) {
      try {
        await sendUserVerificationEmail(dbUser.email);
      } catch (err) {
        console.error('[POST /api/auth/signin] verification email failed:', err);
        return NextResponse.json(
          {
            error: {
              message: verificationEmailErrorMessage(err),
              code: 'EMAIL_NOT_VERIFIED',
            },
            data: { needsVerification: true, email: dbUser.email },
          },
          { status: 403 },
        );
      }

      return NextResponse.json(
        {
          error: {
            message:
              'Please verify your email before signing in. We sent a new verification link to your inbox.',
            code: 'EMAIL_NOT_VERIFIED',
          },
          data: { needsVerification: true, email: dbUser.email },
        },
        { status: 403 },
      );
    }

    // Skip 2FA when the caller already has a valid session for this user
    // (e.g. Settings → change password re-auth).
    const existingSession = await sessionUserFromRequest(request);
    const alreadyAuthedAsUser = existingSession?.id === dbUser.id;

    if (isTwoFactorEnabledFlag(dbUser.two_factor_enabled) && !alreadyAuthedAsUser) {
      try {
        const { challengeToken } = await issueLoginOtp(dbUser.id, dbUser.email);
        return NextResponse.json(
          {
            data: {
              needs2FA: true,
              challengeToken,
              email: dbUser.email,
            },
            error: {
              message:
                'Enter the verification code we sent to your email to finish signing in.',
              code: 'TWO_FACTOR_REQUIRED',
            },
          },
          { status: 403 },
        );
      } catch (err) {
        console.error('[POST /api/auth/signin] 2FA OTP email failed:', err);
        return NextResponse.json(
          {
            error: {
              message: loginOtpEmailErrorMessage(err),
              code: 'TWO_FACTOR_EMAIL_FAILED',
            },
          },
          { status: 500 },
        );
      }
    }

    return completeSignIn(dbUser);
  } catch (err: any) {
    console.error('[POST /api/auth/signin] unexpected error:', err);
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}
