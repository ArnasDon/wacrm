import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  createLead: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}));
vi.mock('@/lib/routing/create-lead', () => ({
  createLead: mocks.createLead,
}));

const { POST } = await import('./route');

function request(body: unknown) {
  return new Request('http://localhost/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/leads', () => {
  it('requires agent+', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await POST(request({ contact_id: 'c-1', title: 'Fleet enquiry' }));
    expect(res.status).toBe(403);
  });

  it('400s when contact_id is missing — deals.contact_id is NOT NULL (migration 001)', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: {},
      userId: 'u-1',
      accountId: 'acct-1',
    });
    const res = await POST(request({ title: 'Fleet enquiry' }));
    expect(res.status).toBe(400);
    expect(mocks.createLead).not.toHaveBeenCalled();
  });

  it('400s when title is missing', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: {},
      userId: 'u-1',
      accountId: 'acct-1',
    });
    const res = await POST(request({ contact_id: 'c-1' }));
    expect(res.status).toBe(400);
  });

  it('400s on a negative value', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: {},
      userId: 'u-1',
      accountId: 'acct-1',
    });
    const res = await POST(
      request({ contact_id: 'c-1', title: 'Fleet enquiry', value: -100 })
    );
    expect(res.status).toBe(400);
  });

  it('400s on an unknown source', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: {},
      userId: 'u-1',
      accountId: 'acct-1',
    });
    const res = await POST(
      request({ contact_id: 'c-1', title: 'Fleet enquiry', source: 'telepathy' })
    );
    expect(res.status).toBe(400);
  });

  it('delegates to createLead on the happy path', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: { marker: 'db' },
      userId: 'u-1',
      accountId: 'acct-1',
    });
    mocks.createLead.mockResolvedValueOnce({ id: 'lead-1', title: 'Fleet enquiry' });

    const res = await POST(request({ contact_id: 'c-1', title: 'Fleet enquiry' }));

    expect(res.status).toBe(201);
    expect(mocks.createLead).toHaveBeenCalledWith(
      { marker: 'db' },
      expect.objectContaining({
        accountId: 'acct-1',
        userId: 'u-1',
        contactId: 'c-1',
        title: 'Fleet enquiry',
        source: 'manual',
      })
    );
  });
});
