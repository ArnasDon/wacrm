import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { createLocalAuth } from './config';
import { createTestDatabase } from '@/lib/db/test-database';

describe('local password authentication', () => {
  let db: PGlite;
  let auth: ReturnType<typeof createLocalAuth>;
  let cookie: string;
  let userId: string;
  const mail: string[] = [];
  const verificationMail: string[] = [];
  const origin = 'http://localhost:3000';
  const password = 'local-password-12345';
  const call = (path: string, body?: unknown, sessionCookie?: string) =>
    auth.handler(
      new Request(`${origin}/api/auth/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    );
  beforeAll(async () => {
    db = await createTestDatabase();
    await db.exec(
      'RESET ROLE; SET ROLE omni_auth; SET search_path TO identity, public;'
    );
    // The same PostgreSQL statements used by the production pg driver run against
    // embedded PostgreSQL. Serialize leases so transactions cannot interleave.
    let lease = Promise.resolve();
    const pool = {
      async connect() {
        const previous = lease;
        let release!: () => void;
        lease = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        return {
          query: async (sql: string, values: unknown[] = []) => {
            const result = await db.query(sql, values);
            return {
              rows: result.rows,
              rowCount: result.affectedRows ?? result.rows.length,
              command: sql.split(' ')[0].toUpperCase(),
            };
          },
          release,
        };
      },
      async end() {},
    } as unknown as Pool;
    auth = createLocalAuth({
      pool,
      secret: 'test-only-secret-at-least-thirty-two-characters',
      baseURL: origin,
      sendResetEmail: async (_email, url) => {
        mail.push(url);
      },
      sendVerificationEmail: async (_email: string, url: string) => {
        verificationMail.push(url);
      },
    });
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });

  it('signs up with UUIDs and atomically provisions an owner account', async () => {
    const response = await call('sign-up/email', {
      name: 'Local Owner',
      email: 'local@example.test',
      password,
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    userId = body.user.id;
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    cookie = response.headers.get('set-cookie')!.split(';')[0];
    expect(
      (await (await call('get-session', undefined, cookie)).json()).user.id
    ).toBe(userId);
    await db.exec('RESET ROLE');
    try {
      expect(
        (
          await db.query(
            'SELECT account_role FROM public.profiles WHERE user_id=$1',
            [userId]
          )
        ).rows
      ).toEqual([{ account_role: 'owner' }]);
      expect(
        (await db.query('SELECT count(*)::int AS n FROM public.accounts')).rows
      ).toEqual([{ n: 1 }]);
      const rows = (
        await db.query<{ password: string }>(
          'SELECT password FROM identity.credentials'
        )
      ).rows;
      expect(rows[0].password).not.toBe(password);
    } finally {
      await db.exec('SET ROLE omni_auth');
    }
  });

  it('rejects duplicate signup and incorrect passwords', async () => {
    expect(
      (
        await call('sign-up/email', {
          name: 'Duplicate',
          email: 'local@example.test',
          password,
        })
      ).status
    ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await call('sign-in/email', {
          email: 'local@example.test',
          password: 'incorrect-password',
        })
      ).status
    ).toBe(401);
  });

  it('logs in, logs out, and refuses revoked or expired sessions', async () => {
    const login = await call('sign-in/email', {
      email: 'local@example.test',
      password,
    });
    expect(login.status).toBe(200);
    cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect((await call('sign-out', {}, cookie)).status).toBe(200);
    expect(
      await (await call('get-session', undefined, cookie)).json()
    ).toBeNull();
    const again = await call('sign-in/email', {
      email: 'local@example.test',
      password,
    });
    cookie = again.headers.get('set-cookie')!.split(';')[0];
    await db.query(
      "UPDATE identity.sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
      [userId]
    );
    expect(
      await (await call('get-session', undefined, cookie)).json()
    ).toBeNull();
  });

  it('delivers a local reset link, rejects invalid tokens, and changes the password', async () => {
    expect(
      (
        await call('request-password-reset', {
          email: 'local@example.test',
          redirectTo: `${origin}/reset-password`,
        })
      ).status
    ).toBe(200);
    expect(mail).toHaveLength(1);
    expect(
      (
        await call('reset-password', {
          token: 'invalid',
          newPassword: 'replacement-password-123',
        })
      ).status
    ).toBeGreaterThanOrEqual(400);
    const token = new URL(mail[0]).pathname.split('/').pop();
    expect(
      (
        await call('reset-password', {
          token,
          newPassword: 'replacement-password-123',
        })
      ).status
    ).toBe(200);
    expect(
      (await call('sign-in/email', { email: 'local@example.test', password }))
        .status
    ).toBe(401);
    expect(
      (
        await call('sign-in/email', {
          email: 'local@example.test',
          password: 'replacement-password-123',
        })
      ).status
    ).toBe(200);
  });

  it('revokes every session across devices', async () => {
    const login = await call('sign-in/email', {
      email: 'local@example.test',
      password: 'replacement-password-123',
    });
    const first = login.headers.get('set-cookie')!.split(';')[0];
    const secondLogin = await call('sign-in/email', {
      email: 'local@example.test',
      password: 'replacement-password-123',
    });
    const second = secondLogin.headers.get('set-cookie')!.split(';')[0];
    expect((await call('revoke-sessions', {}, second)).status).toBe(200);
    expect(
      await (await call('get-session', undefined, first)).json()
    ).toBeNull();
    expect(
      await (await call('get-session', undefined, second)).json()
    ).toBeNull();
  });

  it('changes email only after verification and synchronizes the CRM profile', async () => {
    const signup = await call('sign-up/email', {
      name: 'Email Change',
      email: 'email-before@example.test',
      password,
    });
    const changedUser = (await signup.json()).user.id;
    const sessionCookie = signup.headers.get('set-cookie')!.split(';')[0];
    const requested = await call(
      'change-email',
      {
        newEmail: 'email-after@example.test',
        callbackURL: `${origin}/settings`,
      },
      sessionCookie
    );
    expect(requested.status).toBe(200);
    expect(verificationMail).toHaveLength(1);
    expect(
      (
        await db.query<{ email: string }>(
          'SELECT email FROM identity.users WHERE id=$1',
          [changedUser]
        )
      ).rows[0].email
    ).toBe('email-before@example.test');
    const verified = await auth.handler(
      new Request(verificationMail[0], { headers: { Cookie: sessionCookie } })
    );
    expect([200, 302]).toContain(verified.status);
    expect(
      (
        await db.query<{ email: string }>(
          'SELECT email FROM identity.users WHERE id=$1',
          [changedUser]
        )
      ).rows[0].email
    ).toBe('email-after@example.test');
    await db.exec('RESET ROLE');
    try {
      expect(
        (
          await db.query<{ email: string }>(
            'SELECT email FROM public.profiles WHERE user_id=$1',
            [changedUser]
          )
        ).rows[0].email
      ).toBe('email-after@example.test');
    } finally {
      await db.exec('SET ROLE omni_auth');
    }
  });

  it('leaves no user or session if account provisioning fails', async () => {
    await db.exec(`RESET ROLE;
      CREATE FUNCTION public.fail_test_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'provisioning test failure'; END; $$;
      CREATE TRIGGER fail_test_account BEFORE INSERT ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.fail_test_account();
      SET ROLE omni_auth;`);
    try {
      expect(
        (
          await call('sign-up/email', {
            name: 'Failed',
            email: 'failed@example.test',
            password,
          })
        ).status
      ).toBeGreaterThanOrEqual(400);
      expect(
        (
          await db.query(
            "SELECT id FROM identity.users WHERE email='failed@example.test'"
          )
        ).rows
      ).toEqual([]);
    } finally {
      await db.exec(
        'RESET ROLE; DROP TRIGGER fail_test_account ON public.accounts; DROP FUNCTION public.fail_test_account(); SET ROLE omni_auth;'
      );
    }
  });
});
