import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function isPlatformAdmin(email?: string, systemRole?: string | null): boolean {
  if (systemRole === 'superadmin') return true;
  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (email && adminEmails.includes(email.toLowerCase())) {
    return true;
  }
  return false;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_role, role')
      .eq('user_id', user.id)
      .maybeSingle();

    // Enforce platform superadmin privileges to prevent multi-tenant data leak
    if (!isPlatformAdmin(user.email, profile?.role)) {
      return NextResponse.json(
        { error: 'Forbidden. Platform Superadmin privileges required.' },
        { status: 403 }
      );
    }

    const admin = getAdminClient();

    // 1. Fetch all accounts / clients
    const { data: accounts, error: accErr } = await admin
      .from('accounts')
      .select('id, name, created_at, owner_user_id')
      .order('created_at', { ascending: false });

    if (accErr) {
      return NextResponse.json({ error: accErr.message }, { status: 500 });
    }

    // 2. Fetch all profiles for member count
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, account_id, full_name, email');

    // 3. Fetch WhatsApp connection status
    const { data: waConfigs } = await admin
      .from('whatsapp_config')
      .select('account_id, phone_number_id, waba_id, registered_at');

    // 4. Fetch subscriptions
    const { data: subscriptions } = await admin
      .from('subscriptions')
      .select('account_id, plan_tier, status, current_period_end');

    // 5. Aggregate data per client
    const clients = (accounts || []).map((acc) => {
      const members = (profiles || []).filter((p) => p.account_id === acc.id);
      const waConfig = (waConfigs || []).find((w) => w.account_id === acc.id);
      const sub = (subscriptions || []).find((s) => s.account_id === acc.id);

      return {
        id: acc.id,
        name: acc.name,
        created_at: acc.created_at,
        owner_user_id: acc.owner_user_id,
        member_count: members.length,
        whatsapp_connected: !!waConfig?.phone_number_id,
        phone_number_id: waConfig?.phone_number_id || null,
        plan_tier: sub?.plan_tier || 'starter',
        subscription_status: sub?.status || 'trialing',
        current_period_end: sub?.current_period_end || null,
      };
    });

    return NextResponse.json({ clients });
  } catch (error) {
    console.error('Error fetching admin client list:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
