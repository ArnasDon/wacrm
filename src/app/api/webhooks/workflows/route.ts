import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).maybeSingle();
    if (!profile?.account_id) return NextResponse.json({ error: 'No account linked' }, { status: 403 });

    const { data: workflows, error } = await supabase
      .from('webhook_workflows')
      .select('*')
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ workflows });
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

    // Check count limit
    const { count, error: countErr } = await supabase
      .from('webhook_workflows')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', profile.account_id);

    if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
    if (count !== null && count >= 5) {
      return NextResponse.json({ error: 'Maximum limit of 5 workflows reached.' }, { status: 400 });
    }

    // Fetch integration id
    const { data: integration } = await supabase
      .from('webhook_integrations')
      .select('id')
      .eq('account_id', profile.account_id)
      .maybeSingle();

    if (!integration) {
      return NextResponse.json({ error: 'Please configure the integration settings first.' }, { status: 400 });
    }

    const body = await request.json();
    const { name, recipient_name_field, recipient_phone_field, recipient_email_field, conditions, actions, is_active, create_contacts } = body;

    if (!name) return NextResponse.json({ error: 'Workflow Name is required' }, { status: 400 });
    if (!recipient_phone_field) return NextResponse.json({ error: 'Recipient phone mapping is required' }, { status: 400 });
    if (!recipient_name_field) return NextResponse.json({ error: 'Recipient name mapping is required' }, { status: 400 });

    const { data: workflow, error } = await supabase
      .from('webhook_workflows')
      .insert({
        account_id: profile.account_id,
        integration_id: integration.id,
        name,
        recipient_name_field,
        recipient_phone_field,
        recipient_email_field: recipient_email_field || null,
        conditions: conditions || { matchType: 'all', rules: [] },
        actions: actions || [],
        is_active: is_active !== false,
        create_contacts: create_contacts !== false
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ workflow });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
