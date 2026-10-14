import type { SqlConnection } from './transaction';
import { resolveAccount } from './context-core';
import { queryRows } from './rows';
import {
  canManageMembers,
  isAccountRole,
  type AccountRole,
} from '@/lib/auth/roles';
import type { AccountMember } from '@/types';

export async function listMembers(
  db: SqlConnection,
  userId: string
): Promise<AccountMember[]> {
  const context = await resolveAccount(db, userId);
  const rows = await queryRows<{
    user_id: string;
    full_name: string;
    email: string | null;
    avatar_url: string | null;
    account_role: string;
    created_at: string;
  }>(
    db,
    `SELECT user_id, full_name, CASE WHEN $2 THEN email ELSE NULL END AS email, avatar_url, account_role, created_at
     FROM public.profiles WHERE account_id=$1 ORDER BY created_at, id`,
    [context.accountId, canManageMembers(context.role)]
  );
  return rows.flatMap((row) =>
    isAccountRole(row.account_role)
      ? [
          {
            user_id: row.user_id,
            full_name: row.full_name,
            email: row.email,
            avatar_url: row.avatar_url,
            role: row.account_role,
            joined_at: row.created_at,
          },
        ]
      : []
  );
}

export async function setMemberRole(
  db: SqlConnection,
  userId: string,
  role: AccountRole
): Promise<void> {
  await db.query(
    'SELECT public.set_member_role($1::uuid,$2::public.account_role_enum)',
    [userId, role]
  );
}

export async function removeMember(
  db: SqlConnection,
  userId: string
): Promise<string> {
  const [row] = await queryRows<{ id: string }>(
    db,
    'SELECT public.remove_account_member($1::uuid) AS id',
    [userId]
  );
  return row.id;
}

export async function transferOwnership(
  db: SqlConnection,
  userId: string
): Promise<void> {
  await db.query('SELECT public.transfer_account_ownership($1::uuid)', [
    userId,
  ]);
}
