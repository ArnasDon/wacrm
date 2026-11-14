import { NextResponse } from 'next/server';

import { isPlatformAdmin } from '@/lib/auth/platform-admin';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError) {
    console.error('[GET /api/auth/platform-role] profile lookup failed:', profileError);
    return NextResponse.json(
      { error: 'Failed to determine platform role' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { isPlatformAdmin: isPlatformAdmin(user.email, profile?.role) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
