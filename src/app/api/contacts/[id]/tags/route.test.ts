import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  added: true,
  order: [] as string[],
  scope: null as unknown,
}));
vi.mock('@/lib/api/local-route', () => ({
  requireUUID: (value: unknown) => value,
  readObject: (request: Request) => request.json(),
  RequestError: class extends Error {},
  accountRoute: async (
    _request: Request,
    minimum: string,
    work: (db: unknown, ctx: unknown) => Promise<unknown>,
    after?: (result: unknown, ctx: unknown) => Promise<void>
  ) => {
    expect(minimum).toBe('agent');
    const ctx = { accountId: 'account-1' };
    const result = await work({}, ctx);
    state.order.push('commit');
    if (after) await after(result, ctx);
    return Response.json(result);
  },
}));
vi.mock('@/lib/db/contacts', () => ({
  setContactTag: async (
    _db: unknown,
    accountId: string,
    contactId: string,
    tagId: string
  ) => {
    state.scope = { accountId, contactId, tagId };
    return state.added;
  },
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: async () => {
    state.order.push('dispatch');
  },
}));
import { POST, DELETE } from './route';

describe('local contact tags route', () => {
  beforeEach(() => {
    state.added = true;
    state.order = [];
    state.scope = null;
  });
  const request = (method: string) =>
    new Request('http://localhost/api/contacts/contact-1/tags', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_id: 'tag-1' }),
    });
  const params = { params: Promise.resolve({ id: 'contact-1' }) };
  it('dispatches a newly added tag after commit using server-derived scope', async () => {
    expect(await (await POST(request('POST'), params)).json()).toMatchObject({
      added: true,
      dispatched: true,
    });
    expect(state.scope).toEqual({
      accountId: 'account-1',
      contactId: 'contact-1',
      tagId: 'tag-1',
    });
    expect(state.order).toEqual(['commit', 'dispatch']);
  });
  it('does not dispatch duplicates or removals', async () => {
    state.added = false;
    expect(await (await POST(request('POST'), params)).json()).toMatchObject({
      added: false,
      dispatched: false,
      reason: 'duplicate',
    });
    await DELETE(request('DELETE'), params);
    expect(state.order).toEqual(['commit', 'commit']);
  });
});
