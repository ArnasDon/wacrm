import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).maybeSingle();
    if (!profile?.account_id) return NextResponse.json({ error: 'No account linked' }, { status: 403 });

    const { data: config, error } = await supabase
      .from('webhook_integrations')
      .select('*')
      .eq('account_id', profile.account_id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ config });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).maybeSingle();
    if (!profile?.account_id) return NextResponse.json({ error: 'No account linked' }, { status: 403 });

    const { name, whatsapp_config_id } = await request.json();
    if (!name) return NextResponse.json({ error: 'Integration Name is required' }, { status: 400 });

    const { data: config, error } = await supabase
      .from('webhook_integrations')
      .upsert(
        {
          account_id: profile.account_id,
          name,
          whatsapp_config_id: whatsapp_config_id || null,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'account_id' }
      )
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ config });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
