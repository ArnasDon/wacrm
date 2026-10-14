import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ role: 'viewer' as string, userId: 'server-user', calls: 0, events: [] as string[] }));
vi.mock('@/lib/db/context', () => ({ getLocalAccountContext: async () => ({ userId: state.userId, accountId: 'server-account', role: state.role }), withAccount: async (_ctx: unknown, work: (db: unknown) => unknown) => { state.calls++; state.events.push('begin'); const result = await work({}); state.events.push('commit'); return result; } }));
vi.mock('@/lib/auth/session', () => ({ SessionRequiredError: class extends Error {} }));
import { accountRoute } from './local-route';

describe('local domain route authorization', () => {
  beforeEach(() => { state.role = 'viewer'; state.calls = 0; state.events = []; });
  it('denies cross-origin mutations before executing a repository operation', async () => {
    state.role = 'owner';
    const response = await accountRoute(new Request('http://localhost:3000/api/contacts', { method: 'POST', headers: { Origin: 'https://foreign.example' } }), 'agent', async () => ({ ok: true }));
    expect(response.status).toBe(403);
    expect(state.calls).toBe(0);
  });
  it('denies viewer writes and uses server-derived account identity', async () => {
    const request = new Request('http://localhost:3000/api/contacts', { method: 'POST', headers: { Origin: 'http://localhost:3000' } });
    expect((await accountRoute(request, 'agent', async () => ({}))).status).toBe(403);
    state.role = 'agent';
    const response = await accountRoute(request, 'agent', async (_db, ctx) => ({ accountId: ctx.accountId }));
    expect(await response.json()).toEqual({ accountId: 'server-account' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('dispatches external effects only after the database transaction completes', async () => {
    state.role = 'agent';
    const request = new Request('http://localhost:3000/api/contacts', { method: 'POST', headers: { Origin: 'http://localhost:3000' } });
    const response = await accountRoute(request, 'agent', async () => ({ ok: true }), async () => { state.events.push('dispatch'); });
    expect(response.status).toBe(200);
    expect(state.events).toEqual(['begin', 'commit', 'dispatch']);
  });
  it('returns a non-disclosing 404 when an owned record is missing', async () => {
    const response = await accountRoute(new Request('http://localhost:3000/api/contacts/missing'), 'viewer', async () => {
      throw Object.assign(new Error('A foreign record must not be disclosed'), { code: 'P0002' });
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Record not found.' });
  });
});
