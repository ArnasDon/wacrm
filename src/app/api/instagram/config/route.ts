import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/whatsapp/encryption';
import { verifyInstagramCredentials } from '@/lib/instagram/client';

/**
 * GET /api/instagram/config
 *
 * Returns the Instagram connection status for the authenticated user's account.
 */
export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve account_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json(
        { connected: false, reason: 'no_account', message: 'Your profile is not linked to an account.' },
        { status: 200 }
      );
    }

    const accountId = profile.account_id;

    const { data: config, error: configError } = await supabase
      .from('instagram_config')
      .select('id, ig_user_id, ig_username, status, connected_at, subscribed_at, last_webhook_at')
      .eq('account_id', accountId)
      .maybeSingle();

    if (configError) {
      console.error('[instagram/config] DB error:', configError);
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      );
    }

    if (!config) {
      return NextResponse.json(
        { connected: false, reason: 'no_config', message: 'No Instagram configuration saved yet.' },
        { status: 200 }
      );
    }

    return NextResponse.json({
      connected: config.status === 'connected',
      config: {
        id: config.id,
        ig_user_id: config.ig_user_id,
        ig_username: config.ig_username,
        status: config.status,
        connected_at: config.connected_at,
        subscribed_at: config.subscribed_at,
        last_webhook_at: config.last_webhook_at,
      },
    });
  } catch (error) {
    console.error('[instagram/config] GET error:', error);
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/instagram/config
 *
 * Saves or updates the Instagram config for the authenticated user's account.
 * Verifies credentials with Meta before storing.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const accountId = profile.account_id;
    const body = await request.json();
    const { ig_user_id, access_token, verify_token } = body;

    if (!ig_user_id || !access_token) {
      return NextResponse.json(
        { error: 'ig_user_id and access_token are required' },
        { status: 400 }
      );
    }

    // Verify credentials with Meta BEFORE saving
    let userInfo;
    try {
      userInfo = await verifyInstagramCredentials({
        igUserId: ig_user_id,
        accessToken: access_token,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('[instagram/config] Meta verification failed:', message);
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      );
    }

    // Encrypt sensitive tokens
    let encryptedAccessToken: string;
    let encryptedVerifyToken: string | null;
    try {
      encryptedAccessToken = encrypt(access_token);
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error';
      console.error('[instagram/config] Encryption failed:', message);
      return NextResponse.json(
        { error: 'Failed to encrypt token. Check that ENCRYPTION_KEY is configured.' },
        { status: 500 }
      );
    }

    // Check for existing config
    const { data: existing } = await supabase
      .from('instagram_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle();

    const baseRow = {
      ig_user_id: ig_user_id,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      ig_username: userInfo.username,
      status: 'connected' as const,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { error: updateError } = await supabase
        .from('instagram_config')
        .update(baseRow)
        .eq('account_id', accountId);

      if (updateError) {
        console.error('[instagram/config] Update error:', updateError);
        return NextResponse.json(
          { error: 'Failed to update configuration' },
          { status: 500 }
        );
      }
    } else {
      const { error: insertError } = await supabase
        .from('instagram_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          ...baseRow,
        });

      if (insertError) {
        console.error('[instagram/config] Insert error:', insertError);
        return NextResponse.json(
          { error: 'Failed to save configuration' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      saved: true,
      ig_username: userInfo.username,
    });
  } catch (error) {
    console.error('[instagram/config] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/instagram/config
 *
 * Removes the Instagram configuration for the authenticated user's account.
 */
export async function DELETE() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await supabase
      .from('instagram_config')
      .delete()
      .eq('account_id', profile.account_id);

    if (deleteError) {
      console.error('[instagram/config] Delete error:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[instagram/config] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

