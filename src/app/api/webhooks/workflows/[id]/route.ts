import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).maybeSingle();
    if (!profile?.account_id) return NextResponse.json({ error: 'No account linked' }, { status: 403 });

    const body = await request.json();
    const { name, recipient_name_field, recipient_phone_field, recipient_email_field, conditions, actions, is_active, create_contacts } = body;

    if (!name) return NextResponse.json({ error: 'Workflow Name is required' }, { status: 400 });
    if (!recipient_phone_field) return NextResponse.json({ error: 'Recipient phone mapping is required' }, { status: 400 });
    if (!recipient_name_field) return NextResponse.json({ error: 'Recipient name mapping is required' }, { status: 400 });

    const { data: workflow, error } = await supabase
      .from('webhook_workflows')
      .update({
        name,
        recipient_name_field,
        recipient_phone_field,
        recipient_email_field: recipient_email_field || null,
        conditions: conditions || { matchType: 'all', rules: [] },
        actions: actions || [],
        is_active: is_active !== false,
        create_contacts: create_contacts !== false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('account_id', profile.account_id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ workflow });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).maybeSingle();
    if (!profile?.account_id) return NextResponse.json({ error: 'No account linked' }, { status: 403 });

    const { error } = await supabase
      .from('webhook_workflows')
      .delete()
      .eq('id', id)
      .eq('account_id', profile.account_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
