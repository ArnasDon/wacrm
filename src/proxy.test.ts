import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
let mockUser: { id: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    }
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return { data: { user: mockUser } };
      },
    },
  }),
}));

// Imported after the mock is registered.
const { proxy } = await import('./proxy');

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  delete process.env.NEXT_PUBLIC_SITE_URL;
  mockUser = null;
  refreshedCookies = [];
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  vi.clearAllMocks();
});

const ROTATED = {
  name: 'sb-test-auth-token',
  value: 'rotated-refresh-token',
  options: { path: '/', httpOnly: true },
};

describe('proxy — refreshed auth cookies survive redirects', () => {
  it('carries the rotated token when redirecting a signed-in user off /login', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await proxy(new NextRequest('https://app.test/login'));

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/dashboard');
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('carries the rotated token when redirecting an unauth user to /login', async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: 'cleared' }];

    const res = await proxy(new NextRequest('https://app.test/dashboard'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.cookies.get(ROTATED.name)?.value).toBe('cleared');
  });

  it('redirects a signed-in user with an invite token to /join/<token>', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await proxy(
      new NextRequest('https://app.test/login?invite=abc123')
    );

    expect(res.headers.get('location')).toContain('/join/abc123');
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('passes through (no redirect) for a signed-in user on a protected page', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await proxy(new NextRequest('https://app.test/dashboard'));

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get('location')).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

describe('proxy — canonical host redirect', () => {
  it('307s a browser request on a non-canonical host to the same path on NEXT_PUBLIC_SITE_URL', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://chatsandia.com';

    const res = await proxy(
      new NextRequest('https://sandia-sandia-crm.kmencc.easypanel.host/admin?tab=x'),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://chatsandia.com/admin?tab=x');
  });

  it('honours X-Forwarded-Host over the raw request host', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://chatsandia.com';

    const res = await proxy(
      new NextRequest('http://0.0.0.0/dashboard', {
        headers: { 'x-forwarded-host': 'sandia-sandia-crm.kmencc.easypanel.host' },
      }),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://chatsandia.com/dashboard');
  });

  it('does not redirect when already on the canonical host', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://chatsandia.com';
    mockUser = { id: 'user-1' };

    const res = await proxy(new NextRequest('https://chatsandia.com/dashboard'));

    expect(res.headers.get('location')).toBeNull();
  });

  it('never redirects /api/* (webhooks, cron) even on a non-canonical host', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://chatsandia.com';

    const res = await proxy(
      new NextRequest(
        'https://sandia-sandia-crm.kmencc.easypanel.host/api/whatsapp/webhook',
      ),
    );

    expect(res.headers.get('location')).toBeNull();
  });

  it('is inert when NEXT_PUBLIC_SITE_URL is unset', async () => {
    // `/` is not a protected path, so nothing else in the proxy redirects it.
    const res = await proxy(new NextRequest('https://whatever.example/'));

    expect(res.headers.get('location')).toBeNull();
  });
});
