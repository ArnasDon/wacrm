import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findOrCreateContact: vi.fn(),
  setContactTags: vi.fn(),
  addContactTags: vi.fn(),
  getContactById: vi.fn(),
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    supabase: {},
    accountId: 'account-1',
  })),
}));

vi.mock('@/lib/api/v1/contacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/v1/contacts')>()),
  resolveAuditUserId: vi.fn(async () => 'owner-1'),
  findOrCreateContact: mocks.findOrCreateContact,
  setContactTags: mocks.setContactTags,
  addContactTags: mocks.addContactTags,
  getContactById: mocks.getContactById,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new Request('https://x.test/api/v1/contacts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getContactById.mockResolvedValue({ id: 'c1', tags: [] });
});

describe('POST /api/v1/contacts tags', () => {
  it('adds the requested tags to an existing contact without removing others', async () => {
    mocks.findOrCreateContact.mockResolvedValue({ id: 'c1', created: false });

    const res = await POST(createRequest({ phone: '+14155550123', tags: ['vip'] }));

    expect(res.status).toBe(200);
    expect(mocks.addContactTags).toHaveBeenCalledWith(
      {},
      'account-1',
      'owner-1',
      'c1',
      ['vip']
    );
    expect(mocks.setContactTags).not.toHaveBeenCalled();
  });

  it('sets the tags of a newly created contact', async () => {
    mocks.findOrCreateContact.mockResolvedValue({ id: 'c2', created: true });

    const res = await POST(createRequest({ phone: '+14155550123', tags: ['vip', 1] }));

    expect(res.status).toBe(201);
    expect(mocks.setContactTags).toHaveBeenCalledWith(
      {},
      'account-1',
      'owner-1',
      'c2',
      ['vip']
    );
    expect(mocks.addContactTags).not.toHaveBeenCalled();
  });

  it('leaves tags alone when none are passed', async () => {
    mocks.findOrCreateContact.mockResolvedValue({ id: 'c1', created: false });

    await POST(createRequest({ phone: '+14155550123' }));

    expect(mocks.addContactTags).not.toHaveBeenCalled();
    expect(mocks.setContactTags).not.toHaveBeenCalled();
  });
});
