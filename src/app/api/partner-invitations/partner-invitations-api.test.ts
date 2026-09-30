import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashInviteToken } from '@/lib/auth/invitations';
import { createFakeDb } from '@/lib/partners/test-db';
import { __resetRateLimitForTests } from '@/lib/rate-limit';

const state = vi.hoisted(() => ({ db: null as ReturnType<typeof import('@/lib/partners/test-db').createFakeDb> | null }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => state.db!.client }));

const { GET: VALIDATE } = await import('./validate/route');
const { POST: SIGNUP } = await import('./signup/route');

const TOKEN = 'A'.repeat(43);
const future = () => new Date(Date.now() + 3600_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

function seed(invitation: Record<string, unknown> = {}) {
  state.db = createFakeDb({
    tables: {
      profiles: [{ user_id: 'main-1', email: 'main@example.com', full_name: 'Main User', role: 'User', status: 'ACTIVE' }],
      accounts: [],
      partner_invitations: [
        {
          id: 'inv-1',
          parent_user_id: 'main-1',
          email: 'john@example.com',
          company_name: 'ABC Company',
          phone: '+919876543210',
          token_hash: hashInviteToken(TOKEN),
          status: 'PENDING',
          expires_at: future(),
          ...invitation,
        },
      ],
    },
  });
  return state.db;
}

const signupReq = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/partner-invitations/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const validBody = { token: TOKEN, firstName: 'John', lastName: 'Doe', password: 'correct-horse', confirmPassword: 'correct-horse' };

beforeEach(() => __resetRateLimitForTests());

describe('GET /api/partner-invitations/validate', () => {
  const validate = (token: string) =>
    VALIDATE(new Request(`http://localhost/api/partner-invitations/validate?token=${token}`));

  it('returns the prefill data for a live token', async () => {
    seed();
    const res = await validate(TOKEN);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      state: 'valid',
      invitation: { companyName: 'ABC Company', email: 'john@example.com', phone: '+919876543210', inviterName: 'Main User' },
    });
  });

  it('marks and reports an expired token', async () => {
    const db = seed({ expires_at: past() });
    expect(await (await validate(TOKEN)).json()).toEqual({ state: 'expired' });
    expect(db.tables.partner_invitations[0].status).toBe('EXPIRED');
  });

  it.each([
    ['ACCEPTED', 'used'],
    ['REVOKED', 'revoked'],
  ])('reports %s as %s', async (status, expected) => {
    seed({ status });
    expect((await (await validate(TOKEN)).json()).state).toBe(expected);
  });

  it('404s an unknown token', async () => {
    seed();
    expect((await validate('B'.repeat(43))).status).toBe(404);
  });
});

describe('POST /api/partner-invitations/signup', () => {
  it.each(['role', 'parent_user_id', 'parentUserId', 'status'])(
    'rejects a client-supplied %s',
    async (field) => {
      const db = seed();
      const res = await SIGNUP(signupReq({ ...validBody, [field]: 'User' }));
      expect(res.status).toBe(400);
      expect(db.admin.createUser).not.toHaveBeenCalled();
    },
  );

  it('creates the auth user from invitation data and runs the signup transaction', async () => {
    const db = seed();
    const res = await SIGNUP(signupReq(validBody));
    expect(res.status).toBe(201);

    expect(db.admin.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'john@example.com', password: 'correct-horse', email_confirm: true }),
    );
    // role / parent are not parameters — the RPC takes them from the
    // locked invitation row.
    expect(db.rpc).toHaveBeenCalledWith('accept_partner_invitation', {
      p_token_hash: hashInviteToken(TOKEN),
      p_user_id: 'new-user-id',
      p_first_name: 'John',
      p_last_name: 'Doe',
    });
    expect(db.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('deletes the new auth user if the transaction fails', async () => {
    const db = seed();
    db.tables.accounts.push({ id: 'acct-new', owner_user_id: 'new-user-id' });
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invitation_used' } });
    const res = await SIGNUP(signupReq(validBody));
    expect(res.status).toBe(409);
    expect((await res.json()).state).toBe('used');
    expect(db.tables.accounts).toHaveLength(0);
    expect(db.admin.deleteUser).toHaveBeenCalledWith('new-user-id');
  });

  it.each([
    [{ expires_at: past() }, 410, 'expired'],
    [{ status: 'ACCEPTED' }, 409, 'used'],
    [{ status: 'REVOKED' }, 410, 'revoked'],
  ])('refuses %o before creating anything', async (inv, status, expected) => {
    const db = seed(inv);
    const res = await SIGNUP(signupReq(validBody));
    expect(res.status).toBe(status);
    expect((await res.json()).state).toBe(expected);
    expect(db.admin.createUser).not.toHaveBeenCalled();
  });

  it('refuses when an account already exists for the email', async () => {
    const db = seed();
    db.tables.profiles.push({ user_id: 'x', email: 'John@Example.com', role: 'User', status: 'ACTIVE' });
    const res = await SIGNUP(signupReq(validBody));
    expect(res.status).toBe(409);
    expect(db.admin.createUser).not.toHaveBeenCalled();
  });

  it('enforces password rules server-side', async () => {
    const db = seed();
    const res = await SIGNUP(signupReq({ ...validBody, password: 'short', confirmPassword: 'short' }));
    expect(res.status).toBe(400);
    expect(db.admin.createUser).not.toHaveBeenCalled();
  });
});
