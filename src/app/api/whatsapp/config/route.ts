import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getInstance, updateAllWebhooks } from '@/lib/whatsapp/zapi-api'
import type { ZapiCredentials } from '@/lib/whatsapp/zapi-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function buildCredentials(config: {
  zapi_instance_id: string
  zapi_instance_token: string
  zapi_client_token: string
}): ZapiCredentials {
  return {
    instanceId: config.zapi_instance_id,
    instanceToken: decrypt(config.zapi_instance_token),
    clientToken: decrypt(config.zapi_client_token),
  }
}

function buildWebhookUrl(secret: string): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const url = new URL('/api/whatsapp/webhook', siteUrl)
  url.searchParams.set('secret', secret)
  return url.toString()
}

function isWebhookUrlAllowed(url: string): boolean {
  const parsed = new URL(url)
  if (parsed.protocol === 'https:') return true
  return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
}

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

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select(
        'zapi_instance_id, zapi_instance_token, zapi_client_token, zapi_connected_phone, status, connection_status'
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }

    if (!config?.zapi_instance_id || !config.zapi_instance_token || !config.zapi_client_token) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No Z-API configuration saved yet. Enter your instance credentials and connect.',
        },
        { status: 200 }
      )
    }

    try {
      const instance = await getInstance(buildCredentials(config))
      const connected = instance.connected === true
      const connectedPhone =
        typeof instance.phone === 'string'
          ? instance.phone
          : typeof instance.connectedPhone === 'string'
            ? instance.connectedPhone
            : config.zapi_connected_phone || null

      const connectionStatus = connected ? 'CONNECTED' : 'DISCONNECTED'
      if (
        connectionStatus !== config.connection_status ||
        connectedPhone !== config.zapi_connected_phone
      ) {
        await supabase
          .from('whatsapp_config')
          .update({
            connection_status: connectionStatus,
            status: connected ? 'connected' : 'disconnected',
            zapi_connected_phone: connectedPhone,
            ...(connected ? { connected_at: new Date().toISOString() } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', accountId)
      }

      return NextResponse.json({
        connected,
        connection_status: connectionStatus,
        instance_id: config.zapi_instance_id,
        connected_phone: connectedPhone,
        instance: {
          name: instance.name,
          paymentStatus: instance.paymentStatus,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Z-API error'
      return NextResponse.json(
        {
          connected: false,
          reason: 'whatsapp_provider_error',
          connection_status: config.connection_status || 'DISCONNECTED',
          instance_id: config.zapi_instance_id,
          connected_phone: config.zapi_connected_phone,
          message: `Z-API error: ${message}`,
        },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

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

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    let instanceId: string
    let instanceToken: string
    let clientToken: string
    try {
      instanceId = asNonEmptyString(body.instance_id, 'instance_id')
      instanceToken = asNonEmptyString(body.instance_token, 'instance_token')
      clientToken = asNonEmptyString(body.client_token, 'client_token')
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Invalid Z-API credentials' },
        { status: 400 }
      )
    }

    const { data: claimed } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('account_id')
      .eq('zapi_instance_id', instanceId)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimed) {
      return NextResponse.json(
        { error: 'This Z-API instance is already used by another account.' },
        { status: 409 }
      )
    }

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, zapi_webhook_secret')
      .eq('account_id', accountId)
      .maybeSingle()

    const webhookSecret = existing?.zapi_webhook_secret
      ? decrypt(existing.zapi_webhook_secret)
      : randomBytes(32).toString('hex')
    const webhookUrl = buildWebhookUrl(webhookSecret)
    if (!isWebhookUrlAllowed(webhookUrl)) {
      return NextResponse.json(
        {
          error:
            'Z-API requires HTTPS webhooks. Set NEXT_PUBLIC_SITE_URL to your public HTTPS app URL before connecting.',
        },
        { status: 400 }
      )
    }

    const credentials: ZapiCredentials = {
      instanceId,
      instanceToken,
      clientToken,
    }

    let instance
    try {
      instance = await getInstance(credentials)
      await updateAllWebhooks({
        credentials,
        url: webhookUrl,
        notifySentByMe: false,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Z-API error'
      console.error('[whatsapp/config] Z-API setup failed:', message)
      return NextResponse.json(
        { error: `Failed to configure Z-API instance: ${message}` },
        { status: 502 }
      )
    }

    const connected = instance.connected === true
    const connectedPhone =
      typeof instance.phone === 'string'
        ? instance.phone
        : typeof instance.connectedPhone === 'string'
          ? instance.connectedPhone
          : null

    const baseRow = {
      zapi_instance_id: instanceId,
      zapi_instance_token: encrypt(instanceToken),
      zapi_client_token: encrypt(clientToken),
      zapi_webhook_secret: encrypt(webhookSecret),
      zapi_connected_phone: connectedPhone,
      connection_status: connected ? 'CONNECTED' : 'PENDING_QR',
      status: connected ? 'connected' : 'disconnected',
      connected_at: connected ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(baseRow)
        .eq('account_id', accountId)

      if (updateError) {
        return NextResponse.json(
          { error: 'Failed to update configuration' },
          { status: 500 }
        )
      }
    } else {
      const { error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({
          account_id: accountId,
          user_id: user.id,
          ...baseRow,
        })

      if (insertError) {
        return NextResponse.json(
          { error: 'Failed to save configuration' },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      success: true,
      connection_status: baseRow.connection_status,
      instance_id: instanceId,
      connected_phone: connectedPhone,
    })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)

    if (deleteError) {
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
