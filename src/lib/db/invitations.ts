import type { SqlConnection } from './transaction';
import { queryRows } from './rows';
import { resolveAccount } from './context-core';
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
} from '@/lib/auth/invitations';
import { canManageMembers, type AccountRole } from '@/lib/auth/roles';
import type { AccountInvitation } from '@/types';

const invitationColumns =
  'id, account_id, role, created_by_user_id, label, created_at, expires_at, accepted_at, accepted_by_user_id';

export async function createInvitation(
  db: SqlConnection,
  userId: string,
  input: {
    role: Exclude<AccountRole, 'owner'>;
    label?: string;
    expiresInDays?: number;
  }
) {
  const ctx = await resolveAccount(db, userId);
  if (!canManageMembers(ctx.role))
    throw new Error('This action requires the admin role or higher.');
  const { token, hash } = generateInviteToken();
  const [invitation] = await queryRows<AccountInvitation>(
    db,
    `INSERT INTO public.account_invitations(account_id,token_hash,role,created_by_user_id,label,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${invitationColumns}`,
    [
      ctx.accountId,
      hash,
      input.role,
      userId,
      input.label?.trim().slice(0, 80) || null,
      inviteExpiresAt(input.expiresInDays),
    ]
  );
  return { token, invitation };
}

export type InvitationPreview =
  | { ok: false; reason: 'not_found' | 'used' | 'expired' }
  | { ok: true; account_name: string; role: string; expires_at: string };
export async function peekInvitation(
  db: SqlConnection,
  token: string
): Promise<InvitationPreview> {
  const [row] = await queryRows<{ preview: InvitationPreview }>(
    db,
    'SELECT public.peek_invitation($1) AS preview',
    [hashInviteToken(token)]
  );
  return row.preview;
}

export async function redeemInvitation(
  db: SqlConnection,
  token: string
): Promise<string> {
  const [row] = await queryRows<{ id: string }>(
    db,
    'SELECT public.redeem_invitation($1) AS id',
    [hashInviteToken(token)]
  );
  return row.id;
}

export async function listInvitations(
  db: SqlConnection,
  accountId: string
): Promise<AccountInvitation[]> {
  return queryRows(
    db,
    `SELECT ${invitationColumns} FROM public.account_invitations WHERE account_id=$1 AND accepted_at IS NULL AND expires_at>now() ORDER BY created_at DESC`,
    [accountId]
  );
}

export async function revokeInvitation(
  db: SqlConnection,
  accountId: string,
  id: string
): Promise<boolean> {
  return (
    (
      await queryRows(
        db,
        'DELETE FROM public.account_invitations WHERE account_id=$1 AND id=$2 AND accepted_at IS NULL RETURNING id',
        [accountId, id]
      )
    ).length > 0
  );
}
