import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEXT_PATH,
  isEmailOtpType,
  loginFailurePath,
  parseEmailLink,
  parseSupabaseError,
  relativeRedirect,
  safeNextPath,
} from './callback';

describe('safeNextPath', () => {
  it('accepts a same-origin absolute path, with query and hash', () => {
    expect(safeNextPath('/reset-password')).toBe('/reset-password');
    expect(safeNextPath('/join/abc-123')).toBe('/join/abc-123');
    expect(safeNextPath('/inbox?c=1#top')).toBe('/inbox?c=1#top');
    expect(safeNextPath('/')).toBe('/');
    expect(safeNextPath('  /dashboard  ')).toBe('/dashboard');
  });

  it('falls back when next is missing or empty', () => {
    expect(safeNextPath(null)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath('')).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath('   ')).toBe(DEFAULT_NEXT_PATH);
  });

  // `next` is query-string input; a scheme-relative or absolute URL
  // would make the callback an open redirect carrying a fresh session.
  it('rejects anything that could leave the origin', () => {
    expect(safeNextPath('//evil.example/x')).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath('/\\evil.example')).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath('https://evil.example/')).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath('javascript:alert(1)')).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath('evil.example')).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath('dashboard')).toBe(DEFAULT_NEXT_PATH);
  });

  it('rejects control characters that could split the Location header', () => {
    expect(safeNextPath('/ok\r\nSet-Cookie: x=y')).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath('/ok\nX')).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath('/ok\u0000')).toBe(DEFAULT_NEXT_PATH);
  });

  it('rejects absurdly long values', () => {
    expect(safeNextPath('/' + 'a'.repeat(5000))).toBe(DEFAULT_NEXT_PATH);
  });

  it('honours a caller-supplied fallback', () => {
    expect(safeNextPath('//evil.example', '/login')).toBe('/login');
  });
});

describe('parseEmailLink', () => {
  it('prefers the PKCE code when present', () => {
    expect(parseEmailLink(new URLSearchParams('code=abc123'))).toEqual({
      kind: 'code',
      code: 'abc123',
    });
    // A code wins even if a token_hash also rides along.
    expect(
      parseEmailLink(
        new URLSearchParams('code=abc&token_hash=th&type=recovery'),
      ),
    ).toEqual({ kind: 'code', code: 'abc' });
  });

  it('parses a token_hash link with a known type', () => {
    expect(
      parseEmailLink(new URLSearchParams('token_hash=th-1&type=recovery')),
    ).toEqual({ kind: 'token_hash', tokenHash: 'th-1', type: 'recovery' });
    expect(
      parseEmailLink(new URLSearchParams('token_hash=th-2&type=email')),
    ).toEqual({ kind: 'token_hash', tokenHash: 'th-2', type: 'email' });
  });

  it('returns null for a token_hash with a missing or unknown type', () => {
    expect(parseEmailLink(new URLSearchParams('token_hash=th'))).toBeNull();
    expect(
      parseEmailLink(new URLSearchParams('token_hash=th&type=sms')),
    ).toBeNull();
    expect(
      parseEmailLink(new URLSearchParams('token_hash=th&type=RECOVERY')),
    ).toBeNull();
  });

  it('returns null when neither shape is present', () => {
    expect(parseEmailLink(new URLSearchParams(''))).toBeNull();
    expect(parseEmailLink(new URLSearchParams('next=/dashboard'))).toBeNull();
    expect(parseEmailLink(new URLSearchParams('code='))).toBeNull();
    expect(parseEmailLink(new URLSearchParams('code=%20%20'))).toBeNull();
  });
});

describe('isEmailOtpType', () => {
  it('accepts exactly the email OTP types verifyOtp knows', () => {
    for (const t of [
      'signup',
      'invite',
      'magiclink',
      'recovery',
      'email_change',
      'email',
    ]) {
      expect(isEmailOtpType(t)).toBe(true);
    }
    expect(isEmailOtpType('sms')).toBe(false);
    expect(isEmailOtpType('phone_change')).toBe(false);
    expect(isEmailOtpType(null)).toBe(false);
  });
});

describe('parseSupabaseError', () => {
  it('maps an expired-link report to link_expired', () => {
    expect(
      parseSupabaseError(
        new URLSearchParams(
          'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
        ),
      ),
    ).toBe('link_expired');
  });

  it('maps any other upstream error to link_invalid', () => {
    expect(
      parseSupabaseError(new URLSearchParams('error=server_error')),
    ).toBe('link_invalid');
    expect(
      parseSupabaseError(
        new URLSearchParams('error=access_denied&error_code=otp_disabled'),
      ),
    ).toBe('link_invalid');
  });

  it('returns null when Supabase reported nothing', () => {
    expect(parseSupabaseError(new URLSearchParams('code=abc'))).toBeNull();
  });
});

describe('loginFailurePath', () => {
  it('points at /login with the reason the page can explain', () => {
    expect(loginFailurePath('link_expired')).toBe('/login?error=link_expired');
    expect(loginFailurePath('link_invalid')).toBe('/login?error=link_invalid');
  });
});

describe('relativeRedirect', () => {
  it('emits a 303 with a relative Location and no caching', () => {
    const res = relativeRedirect('/reset-password');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/reset-password');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  // The whole point: behind a Cloudflare Tunnel `request.nextUrl.origin`
  // is `https://localhost:3000`, so an absolute Location resolves nowhere.
  it('never upgrades the path to an absolute URL', () => {
    const res = relativeRedirect('/dashboard');
    expect(res.headers.get('location')).not.toMatch(/^https?:/);
  });
});
