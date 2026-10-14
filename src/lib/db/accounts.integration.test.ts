import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from './test-database';
import { withIdentity, resolveAccount } from './context-core';
import {
  listMembers,
  setMemberRole,
  removeMember,
  transferOwnership,
} from './accounts';
import {
  createInvitation,
  peekInvitation,
  redeemInvitation,
} from './invitations';

describe('local membership and invitations', () => {
  let db: PGlite;
  const owner = '10000000-0000-4000-8000-000000000001';
  const member = '10000000-0000-4000-8000-000000000002';
  const foreign = '10000000-0000-4000-8000-000000000003';
  beforeAll(async () => {
    db = await createTestDatabase();
    for (const [id, name] of [
      [owner, 'Owner'],
      [member, 'Member'],
      [foreign, 'Foreign'],
    ]) {
      await db.query(
        'INSERT INTO identity.users(id,name,email) VALUES ($1,$2,$3)',
        [id, name, `${name.toLowerCase()}@example.test`]
      );
    }
    await db.exec('SET ROLE omni_app');
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });
  const as = <T>(id: string, work: (sql: PGlite) => Promise<T>) =>
    withIdentity(db, id, work);

  it('creates a hashed invitation and redeems it exactly once', async () => {
    const invitation = await as(owner, (sql) =>
      createInvitation(sql, owner, { role: 'agent', label: 'Teammate' })
    );
    expect(invitation.token).toHaveLength(43);
    expect(await peekInvitation(db, invitation.token)).toMatchObject({
      ok: true,
      role: 'agent',
    });
    await as(member, (sql) => redeemInvitation(sql, invitation.token));
    expect(await peekInvitation(db, invitation.token)).toMatchObject({
      ok: false,
      reason: 'used',
    });
    await expect(
      as(foreign, (sql) => redeemInvitation(sql, invitation.token))
    ).rejects.toThrow(/already been redeemed/);
    const membership = await as(member, (sql) => resolveAccount(sql, member));
    const account = await as(owner, (sql) => resolveAccount(sql, owner));
    expect(membership.accountId).toBe(account.accountId);
  });

  it('redacts member emails for agents and viewers and blocks their management actions', async () => {
    for (const role of ['agent', 'viewer'] as const) {
      await as(owner, (sql) => setMemberRole(sql, member, role));
      expect(
        (await as(member, (sql) => listMembers(sql, member))).every(
          (row) => row.email === null
        )
      ).toBe(true);
      await expect(
        as(member, (sql) => setMemberRole(sql, owner, 'agent'))
      ).rejects.toThrow(/admin/);
    }
    expect(
      (await as(owner, (sql) => listMembers(sql, owner))).every(
        (row) => row.email !== null
      )
    ).toBe(true);
    expect(await as(foreign, (sql) => listMembers(sql, foreign))).toHaveLength(
      1
    );
    await expect(
      as(owner, (sql) => setMemberRole(sql, foreign, 'agent'))
    ).rejects.toThrow(/not a member/);
  });
  it('refuses moving the owner of a shared account and preserves teammate membership', async () => {
    const invitation = await as(foreign, (sql) =>
      createInvitation(sql, foreign, { role: 'agent' })
    );
    const before = await as(member, (sql) => resolveAccount(sql, member));
    await expect(
      as(owner, (sql) => redeemInvitation(sql, invitation.token))
    ).rejects.toThrow(/shared account|teammates/i);
    expect(
      (await as(member, (sql) => resolveAccount(sql, member))).accountId
    ).toBe(before.accountId);
    expect(await peekInvitation(db, invitation.token)).toMatchObject({
      ok: true,
    });
  });

  it('refuses expired invitations', async () => {
    const invitation = await as(owner, (sql) =>
      createInvitation(sql, owner, { role: 'viewer' })
    );
    await db.exec('RESET ROLE');
    await db.query(
      "UPDATE public.account_invitations SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [invitation.invitation.id]
    );
    await db.exec('SET ROLE omni_app');
    expect(await peekInvitation(db, invitation.token)).toMatchObject({
      ok: false,
      reason: 'expired',
    });
    await expect(
      as(foreign, (sql) => redeemInvitation(sql, invitation.token))
    ).rejects.toThrow(/expired/);
  });

  it('protects the owner, transfers ownership, and creates an account for a removed member', async () => {
    await expect(
      as(owner, (sql) => removeMember(sql, owner))
    ).rejects.toThrow();
    await expect(
      as(owner, (sql) => setMemberRole(sql, member, 'owner'))
    ).rejects.toThrow(/transfer/);
    await as(owner, (sql) => transferOwnership(sql, member));
    expect((await as(member, (sql) => resolveAccount(sql, member))).role).toBe(
      'owner'
    );
    expect((await as(owner, (sql) => resolveAccount(sql, owner))).role).toBe(
      'admin'
    );
    await expect(as(owner, (sql) => removeMember(sql, member))).rejects.toThrow(
      /owner/
    );
    const newAccount = await as(member, (sql) => removeMember(sql, owner));
    expect(
      (await as(owner, (sql) => resolveAccount(sql, owner))).accountId
    ).toBe(newAccount);
  });
  it('refuses deleting local quick replies when a personal owner joins another account', async () => {
    const invitation = await as(member, (sql) =>
      createInvitation(sql, member, { role: 'agent' })
    );
    await as(foreign, async (sql) => {
      const ctx = await resolveAccount(sql, foreign);
      await sql.query(
        "INSERT INTO public.quick_replies(account_id,user_id,title,content_text) VALUES($1,$2,'Saved reply','Keep me')",
        [ctx.accountId, foreign]
      );
    });
    await expect(
      as(foreign, (sql) => redeemInvitation(sql, invitation.token))
    ).rejects.toThrow(/contains data/i);
    expect(
      (
        await as(foreign, (sql) =>
          sql.query('SELECT title FROM public.quick_replies')
        )
      ).rows
    ).toEqual([{ title: 'Saved reply' }]);
  });
});
