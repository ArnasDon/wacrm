import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, transaction } from '@/lib/mysql';
import {
  isEmailVerifiedFlag,
  sendUserVerificationEmail,
  verificationEmailErrorMessage,
} from '@/lib/auth-verification';

function normalizeMobile(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Allow digits, spaces, +, -, and parentheses; keep a compact stored form.
  const cleaned = trimmed.replace(/[^\d+]/g, '');
  if (cleaned.replace(/\D/g, '').length < 7) return null;
  return cleaned.slice(0, 32);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password;

    // Support both direct client form field and options structure from emulator client
    const fullName = (body.fullName || body.options?.data?.full_name || '').trim();
    const mobileNo = normalizeMobile(
      body.mobileNo ?? body.mobile_no ?? body.options?.data?.mobile_no,
    );
    const inviteToken = body.options?.data?.invite_token as string | undefined;
    const verificationNext = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : '/dashboard';

    if (!email || !password) {
      return NextResponse.json({ error: { message: 'Email and password are required' } }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: { message: 'Password must be at least 6 characters' } }, { status: 400 });
    }

    const mobileRaw =
      body.mobileNo ?? body.mobile_no ?? body.options?.data?.mobile_no;
    if (typeof mobileRaw === 'string' && mobileRaw.trim() && !mobileNo) {
      return NextResponse.json(
        { error: { message: 'Enter a valid mobile number' } },
        { status: 400 },
      );
    }

    const existing = await query<{ id: string; email_verified?: number | boolean }>(
      'SELECT id, email_verified FROM users WHERE email = ?',
      [email],
    );
    if (existing.length > 0) {
      if (isEmailVerifiedFlag(existing[0].email_verified)) {
        return NextResponse.json({ error: { message: 'User already exists' } }, { status: 400 });
      }

      try {
        await sendUserVerificationEmail(email, verificationNext);
      } catch (err) {
        console.error('[POST /api/auth/signup] verification email failed:', err);
        return NextResponse.json(
          {
            error: {
              message: verificationEmailErrorMessage(err),
              code: 'EMAIL_NOT_VERIFIED',
            },
            data: { needsVerification: true, email },
          },
          { status: 400 },
        );
      }

      return NextResponse.json({
        data: { needsVerification: true, email },
        error: null,
      });
    }

    const userId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const hash = bcrypt.hashSync(password, 10);

    // Bootstrap user, account, and profile inside transaction
    await transaction(async (conn) => {
      await conn.query(
        'INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 0)',
        [userId, email, hash],
      );
      await conn.query('INSERT INTO accounts (id, name, owner_user_id) VALUES (?, ?, ?)', [accountId, fullName || email, userId]);
      await conn.query(
        'INSERT INTO profiles (id, user_id, full_name, email, mobile_no, account_id, account_role) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [profileId, userId, fullName, email, mobileNo, accountId, 'owner'],
      );
    });

    try {
      await sendUserVerificationEmail(email, verificationNext);
    } catch (err) {
      console.error('[POST /api/auth/signup] verification email failed:', err);
      return NextResponse.json(
        {
          error: {
            message: verificationEmailErrorMessage(err),
            code: 'EMAIL_NOT_VERIFIED',
          },
          data: { needsVerification: true, email },
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: { needsVerification: true, email },
      error: null,
    });
  } catch (err: any) {
    console.error('[POST /api/auth/signup] unexpected error:', err);
    return NextResponse.json({ error: { message: err.message } }, { status: 500 });
  }
}
