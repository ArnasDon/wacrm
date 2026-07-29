import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { requirePlatformAdmin } from '@/lib/auth/platform';
import { toErrorResponse } from '@/lib/auth/account';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

const VALID_STATUSES = ['active', 'suspended'] as const;

/**
 * PATCH /api/platform/organizations/[id]/status
 *
 * Platform-admin only. The ONLY way organizations.status ever
 * changes — deliberately not exposed as an RLS UPDATE policy (see
 * migration 042's security-model note), so every status flip is
 * auditable through this one route rather than an open-ended client
 * write. Suspending blocks read+write access for every member of
 * every account in the organization (enforced centrally in
 * is_account_member()); the platform admin's own cross-account
 * SELECT access is never gated by that function, so they can always
 * get back in to investigate.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin();
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const status = typeof body?.status === 'string' ? body.status : '';

    if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      );
    }

    const { data: org, error } = await supabaseAdmin()
      .from('organizations')
      .update({ status })
      .eq('id', id)
      .select('id, name, status')
      .maybeSingle();

    if (error) {
      console.error('[platform/organizations/status] update error:', error);
      return NextResponse.json({ error: 'Failed to update organization status' }, { status: 500 });
    }
    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({ organization: org });
  } catch (err) {
    return toErrorResponse(err);
  }
}
