import { beforeEach, describe, expect, it, vi } from 'vitest';

// The server client wraps `next/headers`, which has no request scope
// under vitest — stub the whole module and script the two exchange
// methods the route can call.
const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}));

import { GET } from './route';

function request(query: string): Request {
  return new Request(`http://localhost:3000/auth/callback?${query}`);
}

beforeEach(() => {
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
  mocks.verifyOtp.mockResolvedValue({ error: null });
  mocks.createClient.mockResolvedValue({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      verifyOtp: mocks.verifyOtp,
    },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('GET /auth/callback', () => {
  it('exchanges a PKCE code and redirects to the validated next path', async () => {
    const res = await GET(request('code=pkce-123&next=%2Freset-password'));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('pkce-123');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/reset-password');
  });

  it('verifies a token_hash link through verifyOtp', async () => {
    const res = await GET(
      request('token_hash=th-1&type=recovery&next=%2Freset-password'),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      type: 'recovery',
      token_hash: 'th-1',
    });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('/reset-password');
  });

  it('defaults next to /dashboard when absent', async () => {
    const res = await GET(request('code=abc'));
    expect(res.headers.get('location')).toBe('/dashboard');
  });

  // `next` is attacker-controllable query input: the callback has just
  // minted a session and must not hand the browser to another origin.
  it('refuses an off-origin next and falls back to /dashboard', async () => {
    for (const next of ['//evil.example', 'https://evil.example', '/\\x']) {
      const res = await GET(request(`code=abc&next=${encodeURIComponent(next)}`));
      expect(res.headers.get('location')).toBe('/dashboard');
    }
  });

  it('sends a failed exchange to /login with a reason, not a 404 or a raw error', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: 'PKCE code verifier not found' },
    });

    const res = await GET(request('code=stale&next=%2Freset-password'));

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login?error=link_invalid');
    expect(console.warn).toHaveBeenCalled();
  });

  it('reports a link Supabase already rejected as expired, without touching the client', async () => {
    const res = await GET(
      request(
        'error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
    );

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('/login?error=link_expired');
  });

  it('treats a bare visit with no credential as an invalid link', async () => {
    const res = await GET(request('next=%2Fdashboard'));

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('/login?error=link_invalid');
  });

  it('emits a relative Location so the redirect works behind a reverse proxy', async () => {
    const res = await GET(request('code=abc&next=%2Fjoin%2Ftoken-1'));
    expect(res.headers.get('location')).toBe('/join/token-1');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
