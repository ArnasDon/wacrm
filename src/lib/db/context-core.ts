import { transaction, type SqlConnection } from './transaction';
import { isAccountRole, type AccountRole } from '@/lib/auth/roles';

export interface LocalAccountContext {
  userId: string;
  accountId: string;
  role: AccountRole;
  account: { id: string; name: string; default_currency: string };
}

export class MembershipRequiredError extends Error {
  readonly status = 403;
  constructor() {
    super('An active account membership is required.');
    this.name = 'MembershipRequiredError';
  }
}

export async function withIdentity<T, C extends SqlConnection>(
  db: C,
  userId: string,
  work: (db: C) => Promise<T>
): Promise<T> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId
    )
  )
    throw new Error('Invalid request identity.');
  return transaction(db, async (sql) => {
    await sql.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    return work(sql);
  });
}

export async function resolveAccount(
  db: SqlConnection,
  userId: string
): Promise<LocalAccountContext> {
  const result = (await db.query(
    `SELECT p.account_id, p.account_role, a.name, a.default_currency
    FROM public.profiles p JOIN public.accounts a ON a.id=p.account_id WHERE p.user_id=$1`,
    [userId]
  )) as {
    rows: {
      account_id: string;
      account_role: string;
      name: string;
      default_currency: string;
    }[];
  };
  const row = result.rows[0];
  if (!row || !isAccountRole(row.account_role))
    throw new MembershipRequiredError();
  return {
    userId,
    accountId: row.account_id,
    role: row.account_role,
    account: {
      id: row.account_id,
      name: row.name,
      default_currency: row.default_currency,
    },
  };
}
