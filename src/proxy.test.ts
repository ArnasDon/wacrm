import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ session: null as null | { user: { id: string } }, refreshed: false }));
vi.mock('@/lib/auth/server', () => ({ getAuth: () => ({ api: { getSession: async () => ({
  response: state.session,
  headers: new Headers(state.refreshed ? { 'set-cookie': 'better-auth.session_token=renewed; Path=/; HttpOnly; SameSite=Lax' } : {}),
}) } }) }));
import { proxy } from './proxy';

describe('local authentication proxy', () => {
  beforeEach(() => { state.session = null; state.refreshed = false; });
  it('protects flows and notifications and redirects expired sessions', async () => {
    for (const path of ['/dashboard', '/flows', '/notifications']) {
      const response = await proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
    }
  });
  it('preserves invitation destinations and refreshed cookies', async () => {
    state.session = { user: { id: 'owner' } };
    state.refreshed = true;
    const response = await proxy(new NextRequest('http://localhost:3000/login?invite=abc123'));
    expect(new URL(response.headers.get('location')!).pathname).toBe('/join/abc123');
    expect(response.headers.get('set-cookie')).toContain('session_token=renewed');
  });
  it('returns JSON for protected APIs and leaves auth/webhooks/public keys alone', async () => {
    expect((await proxy(new NextRequest('http://localhost:3000/api/contacts'))).status).toBe(401);
    expect((await proxy(new NextRequest('http://localhost:3000/api/automations/engine'))).status).toBe(401);
    for (const path of ['/api/auth/sign-in/email', '/api/whatsapp/webhook', '/api/v1/contacts', '/api/flows/cron', '/api/automations/cron']) {
      const response = await proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(response.status).toBe(200);
    }
  });
});
