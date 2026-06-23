import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...} }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...' }
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('provider, phone_number_id, access_token, status, evolution_api_url, evolution_api_key, evolution_instance_name')
      .eq('user_id', user.id)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching whatsapp_config:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    if (config.provider === 'evolution') {
      let apiKey: string;
      try {
        apiKey = decrypt(config.evolution_api_key)
      } catch (err) {
        console.error('[whatsapp/config GET] Evolution Token decryption failed:', err)
        return NextResponse.json(
          {
            connected: false,
            reason: 'token_corrupted',
            needs_reset: true,
            message: 'The stored Evolution API Key cannot be decrypted.',
          },
          { status: 200 }
        )
      }

      try {
        const { verifyEvolutionInstance } = await import('@/lib/whatsapp/evolution-api');
        const phoneInfo = await verifyEvolutionInstance({
          config: {
            apiUrl: config.evolution_api_url,
            apiKey,
            instanceName: config.evolution_instance_name,
          }
        })
        return NextResponse.json({ connected: true, phone_info: phoneInfo })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Evolution API error'
        return NextResponse.json(
          {
            connected: false,
            reason: 'meta_api_error',
            message: `Evolution API rejected or instance disconnected: ${message}`,
          },
          { status: 200 }
        )
      }
    } else {
      // Try to decrypt the stored token with the current ENCRYPTION_KEY.
      // If this fails, the key changed (or was never consistent across envs).
      let accessToken: string
      try {
        accessToken = decrypt(config.access_token)
      } catch (err) {
        console.error('[whatsapp/config GET] Token decryption failed:', err)
        return NextResponse.json(
          {
            connected: false,
            reason: 'token_corrupted',
            needs_reset: true,
            message:
              'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
          },
          { status: 200 }
        )
      }

      // Validate credentials against Meta
      try {
        const phoneInfo = await verifyPhoneNumber({
          phoneNumberId: config.phone_number_id,
          accessToken,
        })
        return NextResponse.json({ connected: true, phone_info: phoneInfo })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Meta API error'
        console.error('[whatsapp/config GET] Meta API verification failed:', message)
        return NextResponse.json(
          {
            connected: false,
            reason: 'meta_api_error',
            message: `Meta API rejected the credentials: ${message}`,
          },
          { status: 200 }
        )
      }
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Verifies credentials with Meta first, then encrypts and stores.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { provider = 'meta', phone_number_id, waba_id, access_token, verify_token, evolution_api_url, evolution_api_key, evolution_instance_name } = body

    if (provider === 'evolution') {
      if (!evolution_api_url || !evolution_api_key || !evolution_instance_name) {
        return NextResponse.json(
          { error: 'A URL da API, a API Key e o Nome da Instância são obrigatórios' },
          { status: 400 }
        )
      }

      let phoneInfo = null;
      try {
        const { createEvolutionInstance, verifyEvolutionInstance, setEvolutionWebhook } = await import('@/lib/whatsapp/evolution-api');
        
        try {
          phoneInfo = await verifyEvolutionInstance({
            config: {
              apiUrl: evolution_api_url,
              apiKey: evolution_api_key,
              instanceName: evolution_instance_name,
            }
          });
        } catch (e) {
          // If verification fails, try creating the instance
          await createEvolutionInstance({
            config: {
              apiUrl: evolution_api_url,
              apiKey: evolution_api_key,
              instanceName: evolution_instance_name,
            }
          });
        }
        
        // Auto-configure the webhook on the instance so messages route back to the CRM
        const requestUrl = new URL(request.url);
        const webhookUrl = `${requestUrl.protocol}//${requestUrl.host}/api/whatsapp/evolution-webhook`;
        try {
          await setEvolutionWebhook({
            config: {
              apiUrl: evolution_api_url,
              apiKey: evolution_api_key,
              instanceName: evolution_instance_name,
            },
            webhookUrl
          });
        } catch (webhookErr) {
          console.warn('Failed to set webhook automatically, user might need to set it manually:', webhookErr);
        }

      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erro na Evolution API'
        console.error('Evolution API creation/verification failed:', message)
        return NextResponse.json(
          { error: `Evolution API erro: ${message}` },
          { status: 400 }
        )
      }

      let encryptedApiKey: string
      try {
        encryptedApiKey = encrypt(evolution_api_key)
      } catch (err) {
        return NextResponse.json({ error: 'Failed to encrypt token.' }, { status: 500 })
      }

      const { data: existing } = await supabase
        .from('whatsapp_config')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (existing) {
        const { error: updateError } = await supabase
          .from('whatsapp_config')
          .update({
            provider: 'evolution',
            evolution_api_url,
            evolution_api_key: encryptedApiKey,
            evolution_instance_name,
            phone_number_id: null,
            waba_id: null,
            access_token: null,
            verify_token: null,
            status: phoneInfo ? 'connected' : 'disconnected',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id)

        if (updateError) throw updateError
      } else {
        const { error: insertError } = await supabase
          .from('whatsapp_config')
          .insert({
            user_id: user.id,
            provider: 'evolution',
            evolution_api_url,
            evolution_api_key: encryptedApiKey,
            evolution_instance_name,
            status: phoneInfo ? 'connected' : 'disconnected',
            connected_at: phoneInfo ? new Date().toISOString() : null,
          })

        if (insertError) throw insertError
      }
      return NextResponse.json({ success: true, phone_info: phoneInfo })
    }

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      )
    }

    // Verify credentials with Meta BEFORE saving
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API verification failed during save:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 400 }
      )
    }

    // Encrypt sensitive tokens before storing
    let encryptedAccessToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedAccessToken = encrypt(access_token)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      )
    }

    // Upsert — overwrite any existing (possibly corrupted) config
    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update({
          provider: 'meta',
          phone_number_id,
          waba_id: waba_id || null,
          access_token: encryptedAccessToken,
          verify_token: encryptedVerifyToken,
          evolution_api_url: null,
          evolution_api_key: null,
          evolution_instance_name: null,
          status: 'connected',
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)

      if (updateError) {
        console.error('Error updating whatsapp_config:', updateError)
        return NextResponse.json(
          { error: 'Failed to update configuration' },
          { status: 500 }
        )
      }
    } else {
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          user_id: user.id,
          provider: 'meta',
          phone_number_id,
          waba_id: waba_id || null,
          access_token: encryptedAccessToken,
          verify_token: encryptedVerifyToken,
          status: 'connected',
          connected_at: new Date().toISOString(),
        })

      if (insertError) {
        console.error('Error inserting whatsapp_config:', insertError)
        return NextResponse.json(
          { error: 'Failed to save configuration' },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ success: true, phone_info: phoneInfo })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes the authenticated user's WhatsApp configuration row.
 * Used by the "Reset Configuration" button to recover from a corrupted
 * encrypted token (mismatched ENCRYPTION_KEY across environments).
 */
export async function DELETE() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
