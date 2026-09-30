import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeDb } from '@/lib/partners/test-db';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

// Both the session client (requireMainUser → getCurrentAccount) and the
// service-role client read the same in-memory tables, so the real guard
// and the real ownership filters run in every test.
const state = vi.hoisted(() => ({ db: null as ReturnType<typeof import('@/lib/partners/test-db').createFakeDb> | null }));

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.db!.client }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => state.db!.client }));
vi.mock('@/lib/email/send', async (orig) => ({
  ...(await orig<typeof import('@/lib/email/send')>()),
  sendEmail: vi.fn(async () => ({ sent: true, id: 'email-1' })),
}));

const { GET } = await import('./route');
const { POST: INVITE } = await import('./invite/route');
const { POST: RESEND } = await import('./[id]/resend-invitation/route');
const { POST: REVOKE } = await import('./[id]/revoke-invitation/route');
const { PATCH: STATUS } = await import('./[id]/status/route');

const USER_A = 'user-a';
const USER_B = 'user-b';
const SUB_A1 = 'sub-a1';
const SUB_B1 = 'sub-b1';
const INV_A1 = '00000000-0000-4000-8000-0000000000a1';
const INV_B1 = '00000000-0000-4000-8000-0000000000b1';
const INV_A_PENDING = '00000000-0000-4000-8000-0000000000a2';

function profile(user_id: string, role: 'User' | 'SubUser', extra: Record<string, unknown> = {}) {
  return {
    user_id,
    email: `${user_id}@example.com`,
    full_name: user_id.toUpperCase(),
    account_id: `acct-${user_id}`,
    account_role: 'owner',
    role,
    status: 'ACTIVE',
    parent_user_id: null,
    ...extra,
  };
}

function seed(sessionUserId: string) {
  const future = new Date(Date.now() + 3600_000).toISOString();
  state.db = createFakeDb({
    sessionUserId,
    tables: {
      profiles: [
        profile(USER_A, 'User'),
        profile(USER_B, 'User'),
        profile(SUB_A1, 'SubUser', { parent_user_id: USER_A }),
        profile(SUB_B1, 'SubUser', { parent_user_id: USER_B }),
      ],
      accounts: [USER_A, USER_B, SUB_A1, SUB_B1].map((u) => ({ id: `acct-${u}`, name: u })),
      partner_invitations: [
        { id: INV_A1, parent_user_id: USER_A, email: 'sub-a1@example.com', company_name: 'A1 Co', phone: '+14155550001', status: 'ACCEPTED', expires_at: future, used_at: future, created_user_id: SUB_A1, last_sent_at: null, created_at: '2026-01-01' },
        { id: INV_A_PENDING, parent_user_id: USER_A, email: 'pending@example.com', company_name: 'Pending Co', phone: '+14155550003', status: 'PENDING', expires_at: future, used_at: null, created_user_id: null, last_sent_at: null, created_at: '2026-01-02' },
        { id: INV_B1, parent_user_id: USER_B, email: 'sub-b1@example.com', company_name: 'B1 Co', phone: '+14155550002', status: 'ACCEPTED', expires_at: future, used_at: future, created_user_id: SUB_B1, last_sent_at: null, created_at: '2026-01-01' },
      ],
      notifications: [],
    },
  });
  return state.db;
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (url: string, method: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  __resetRateLimitForTests();
});

describe('Partners API — SubUser is always 403', () => {
  const calls: [string, () => Promise<Response>][] = [
    ['GET /api/partners', () => GET()],
    ['POST /api/partners/invite', () => INVITE(jsonReq('/api/partners/invite', 'POST', { companyName: 'X', email: 'x@example.com', phone: '+14155550123', role: 'User' }))],
    ['POST resend-invitation', () => RESEND(jsonReq('/x', 'POST'), params(INV_A_PENDING))],
    ['POST revoke-invitation', () => REVOKE(jsonReq('/x', 'POST'), params(INV_A_PENDING))],
    ['PATCH status', () => STATUS(jsonReq('/x', 'PATCH', { status: 'DISABLED' }), params(INV_A1))],
  ];

  it.each(calls)('%s', async (_name, call) => {
    const db = seed(SUB_A1);
    const before = JSON.stringify(db.tables);
    const res = await call();
    expect(res.status).toBe(403);
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(db.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('a disabled user is 403 even as a Main User', async () => {
    const db = seed(USER_A);
    db.tables.profiles.find((p) => p.user_id === USER_A)!.status = 'DISABLED';
    expect((await GET()).status).toBe(403);
  });

  it('unauthenticated is 401', async () => {
    seed('');
    expect((await GET()).status).toBe(401);
  });
});

describe('Partners API — Main User ownership', () => {
  it("lists only the caller's partners", async () => {
    seed(USER_A);
    const res = await GET();
    expect(res.status).toBe(200);
    const { partners } = await res.json();
    expect(partners.map((p: { id: string }) => p.id).sort()).toEqual([INV_A1, INV_A_PENDING].sort());
    const a1 = partners.find((p: { id: string }) => p.id === INV_A1);
    expect(a1).toMatchObject({ partnerName: 'SUB-A1', status: 'ACTIVE', invitationStatus: 'ACCEPTED' });
  });

  it("cannot disable another user's SubUser", async () => {
    const db = seed(USER_A);
    const res = await STATUS(jsonReq('/x', 'PATCH', { status: 'DISABLED' }), params(INV_B1));
    expect(res.status).toBe(404);
    expect(db.tables.profiles.find((p) => p.user_id === SUB_B1)!.status).toBe('ACTIVE');
    expect(db.admin.updateUserById).not.toHaveBeenCalled();
  });

  it("cannot resend or revoke another user's invitation", async () => {
    seed(USER_B);
    expect((await RESEND(jsonReq('/x', 'POST'), params(INV_A_PENDING))).status).toBe(404);
    expect((await REVOKE(jsonReq('/x', 'POST'), params(INV_A_PENDING))).status).toBe(404);
    expect(state.db!.tables.partner_invitations.find((i) => i.id === INV_A_PENDING)!.status).toBe('PENDING');
  });

  it('disables and re-enables its own SubUser (profile + auth ban)', async () => {
    const db = seed(USER_A);
    let res = await STATUS(jsonReq('/x', 'PATCH', { status: 'DISABLED' }), params(INV_A1));
    expect(res.status).toBe(200);
    const sub = db.tables.profiles.find((p) => p.user_id === SUB_A1)!;
    expect(sub.status).toBe('DISABLED');
    expect(sub.role).toBe('SubUser');
    expect(db.admin.updateUserById).toHaveBeenLastCalledWith(SUB_A1, { ban_duration: '876000h' });

    res = await STATUS(jsonReq('/x', 'PATCH', { status: 'ACTIVE' }), params(INV_A1));
    expect(res.status).toBe(200);
    expect(sub.status).toBe('ACTIVE');
    expect(sub.role).toBe('SubUser');
    expect(db.admin.updateUserById).toHaveBeenLastCalledWith(SUB_A1, { ban_duration: 'none' });
  });

  it('rolls the profile back if the auth ban fails', async () => {
    const db = seed(USER_A);
    db.admin.updateUserById.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const res = await STATUS(jsonReq('/x', 'PATCH', { status: 'DISABLED' }), params(INV_A1));
    expect(res.status).toBe(502);
    expect(db.tables.profiles.find((p) => p.user_id === SUB_A1)!.status).toBe('ACTIVE');
  });

  it('rejects an invalid status value', async () => {
    seed(USER_A);
    const res = await STATUS(jsonReq('/x', 'PATCH', { status: 'OWNER' }), params(INV_A1));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/partners/invite', () => {
  it('takes the parent from the session, never the body, and stores only a hash', async () => {
    const db = seed(USER_A);
    const res = await INVITE(
      jsonReq('/api/partners/invite', 'POST', {
        companyName: 'New Co',
        email: 'New@Example.com',
        phone: '+91 98765 43210',
        parent_user_id: USER_B,
        parentUserId: USER_B,
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emailSent).toBe(true);
    expect(body.signupUrl).toBeUndefined();

    const row = db.tables.partner_invitations.find((i) => i.email === 'new@example.com')!;
    expect(row).toMatchObject({ parent_user_id: USER_A, phone: '+919876543210', status: 'PENDING' });
    expect(String(row.token_hash)).toMatch(/^[0-9a-f]{64}$/);
    const hours = (new Date(String(row.expires_at)).getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThanOrEqual(72);
  });

  it('rejects invalid input', async () => {
    seed(USER_A);
    const res = await INVITE(jsonReq('/api/partners/invite', 'POST', { companyName: '', email: 'bad', phone: '123' }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toMatchObject({ companyName: 'required', email: 'invalidEmail', phone: 'invalidPhone' });
  });

  it('rejects an email that already has an account', async () => {
    seed(USER_A);
    const res = await INVITE(jsonReq('/api/partners/invite', 'POST', { companyName: 'X', email: 'SUB-B1@example.com', phone: '+14155550123' }));
    expect(res.status).toBe(409);
    expect((await res.json()).fields.email).toBe('accountExists');
  });

  it('rejects a duplicate pending invitation', async () => {
    seed(USER_A);
    const res = await INVITE(jsonReq('/api/partners/invite', 'POST', { companyName: 'X', email: 'pending@example.com', phone: '+14155550123' }));
    expect(res.status).toBe(409);
    expect((await res.json()).fields.email).toBe('pendingInvitation');
  });

  it('returns the link for manual sharing when email is not delivered', async () => {
    seed(USER_A);
    const { sendEmail } = await import('@/lib/email/send');
    vi.mocked(sendEmail).mockResolvedValueOnce({ sent: false, reason: 'not_configured' });
    const res = await INVITE(jsonReq('/api/partners/invite', 'POST', { companyName: 'X', email: 'fresh@example.com', phone: '+14155550123' }));
    const body = await res.json();
    expect(body.emailSent).toBe(false);
    expect(body.signupUrl).toMatch(/\/partner\/signup\?token=[A-Za-z0-9_-]{43}$/);
  });
});

describe('POST /api/partners/:id/resend-invitation', () => {
  it('rotates the token hash atomically through the RPC', async () => {
    const db = seed(USER_A);
    db.rpc.mockResolvedValueOnce({ data: { outcome: 'ok' }, error: null });
    const res = await RESEND(jsonReq('/x', 'POST'), params(INV_A_PENDING));
    expect(res.status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith(
      'resend_partner_invitation',
      expect.objectContaining({
        p_invitation_id: INV_A_PENDING,
        p_parent_user_id: USER_A,
        p_limit: 3,
        p_window_seconds: 3600,
        p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it('maps the RPC rate limit to 429', async () => {
    const db = seed(USER_A);
    db.rpc.mockResolvedValueOnce({ data: { outcome: 'rate_limited', retry_after_seconds: 1200 }, error: null });
    const res = await RESEND(jsonReq('/x', 'POST'), params(INV_A_PENDING));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('1200');
  });

  it('refuses to resend an accepted invitation', async () => {
    const db = seed(USER_A);
    const res = await RESEND(jsonReq('/x', 'POST'), params(INV_A1));
    expect(res.status).toBe(409);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
