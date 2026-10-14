import { getLocalAccountContext, withAccount } from '@/lib/db/context';
import { queryRows } from '@/lib/db/rows';
import { SessionRequiredError } from '@/lib/auth/session';
import { MembershipRequiredError } from '@/lib/db/context-core';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const context = await getLocalAccountContext();
    const [profile] = await withAccount(context, (db) =>
      queryRows(
        db,
        'SELECT id,full_name,email,avatar_url,role,beta_features,account_id,account_role FROM public.profiles WHERE user_id=$1',
        [context.userId]
      )
    );
    return Response.json(
      { profile, account: context.account },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (
      error instanceof SessionRequiredError ||
      error instanceof MembershipRequiredError
    )
      return Response.json({ error: error.message }, { status: error.status });
    console.error('[auth-context] Unable to resolve membership.');
    return Response.json(
      { error: 'Unable to resolve account membership.' },
      { status: 500 }
    );
  }
}
