import { accountRoute } from '@/lib/api/local-route';
import { hasMinRole } from '@/lib/auth/roles';
import { queryRows } from '@/lib/db/rows';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const [counts] = await queryRows(
      db,
      `SELECT
      (SELECT count(*)::int FROM public.profiles WHERE account_id=$1) AS members,
      CASE WHEN $2 THEN (SELECT count(*)::int FROM public.account_invitations WHERE account_id=$1 AND accepted_at IS NULL AND expires_at>now()) ELSE NULL END AS "pendingInvites",
      (SELECT count(*)::int FROM public.message_templates WHERE account_id=$1) AS templates,
      (SELECT count(*)::int FROM public.message_templates WHERE account_id=$1 AND status='PENDING') AS "templatesPending",
      (SELECT count(*)::int FROM public.tags WHERE account_id=$1) AS tags,
      (SELECT count(*)::int FROM public.custom_fields WHERE account_id=$1) AS "customFields"`,
      [ctx.accountId, hasMinRole(ctx.role, 'admin')]
    );
    const [config] = await queryRows<{ configured: boolean }>(
      db,
      'SELECT EXISTS(SELECT 1 FROM public.whatsapp_config WHERE account_id=$1) AS configured',
      [ctx.accountId]
    );
    return { counts, whatsappConfigured: config.configured };
  });
}
