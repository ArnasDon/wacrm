// ============================================================
// /api/whatsapp/evolution
//
//   POST   — save an Evolution Go instance for this account: creates
//            (or reuses) the instance on the target server, registers
//            our webhook, and upserts whatsapp_config with
//            provider='evolution'. Does NOT wait for the QR scan —
//            the client polls GET /api/whatsapp/evolution/qr next.
//   DELETE — best-effort logout + delete the remote instance, then
//            remove the whatsapp_config row (mirrors the Meta
//            "Reset Configuration" DELETE /api/whatsapp/config).
//
// Admin-gated (requireRole('admin')) — same bar as inviting members
// or creating API keys; connecting a WhatsApp number is account-wide
// and security-sensitive (the admin_token below can send messages as
// this business).
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import {
  createInstance,
  connectInstance,
  updateAdvancedSettings,
  logoutInstance,
  deleteInstance,
} from '@/lib/whatsapp/evolution-api'

function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwardedHost) return `${forwardedProto || 'https'}://${forwardedHost}`

  const host = request.headers.get('host')?.trim()
  if (host) {
    const reqProto = new URL(request.url).protocol.replace(':', '')
    return `${reqProto}://${host}`
  }

  return ''
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = await request.json()
    const apiUrl = (body.api_url || '').trim().replace(/\/+$/, '')
    const adminToken = (body.admin_token || '').trim()
    const instanceName = (body.instance_name || '').trim()

    if (!apiUrl || !adminToken || !instanceName) {
      return NextResponse.json(
        { error: 'api_url, admin_token and instance_name are required' },
        { status: 400 }
      )
    }

    const baseUrl = getBaseUrl(request)
    if (!baseUrl) {
      return NextResponse.json(
        {
          error:
            'Could not determine this deployment\'s public URL. Set NEXT_PUBLIC_SITE_URL and try again.',
        },
        { status: 400 }
      )
    }
    const webhookUrl = `${baseUrl}/api/whatsapp/webhook/evolution`

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select(
        'id, evolution_api_url, evolution_instance_name, evolution_instance_uuid, evolution_instance_token'
      )
      .eq('account_id', accountId)
      .maybeSingle()

    // Re-clicking "Connect" (e.g. because the QR expired or the modal
    // was closed before scanning) must not try to create a brand new
    // instance under the same name — Evolution Go rejects that with
    // "instance already exists". If this account already has an
    // instance saved under the same server + name, reuse it: just
    // re-run connect (idempotent — re-registers the webhook) and let
    // the client poll for a fresh QR.
    const canReuse =
      existing?.evolution_instance_uuid &&
      existing.evolution_api_url === apiUrl &&
      existing.evolution_instance_name === instanceName

    let instanceUuid: string
    let instanceToken: string
    try {
      if (canReuse) {
        instanceUuid = existing.evolution_instance_uuid as string
        instanceToken = decrypt(existing.evolution_instance_token as string)
      } else {
        const created = await createInstance({ apiUrl, adminToken, instanceName })
        instanceUuid = created.instanceUuid
        instanceToken = created.instanceToken
      }
      // Order matters: settings BEFORE connect, not after. Confirmed
      // live — Evolution Go only broadcasts presence (the "always
      // online" flag's actual effect on WhatsApp's servers) once, at
      // connect time; PUT-ing a settings change to an *already*-
      // connected session does not retroactively re-broadcast it. So
      // this self-heals an instance created before ADVANCED_SETTINGS
      // last changed (createInstance only applies settings once, at
      // creation) only if the update lands before the connect that
      // follows it.
      await updateAdvancedSettings({ apiUrl, instanceToken, instanceUuid })
      await connectInstance({ apiUrl, instanceToken, webhookUrl })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Evolution Go error'
      console.error('[whatsapp/evolution POST] instance setup failed:', message)
      return NextResponse.json(
        { error: `Evolution Go API error: ${message}` },
        { status: 502 }
      )
    }

    const row = {
      provider: 'evolution',
      evolution_api_url: apiUrl,
      evolution_instance_name: instanceName,
      evolution_instance_uuid: instanceUuid,
      evolution_instance_token: encrypt(instanceToken),
      evolution_admin_token: encrypt(adminToken),
      status: 'disconnected', // flips to 'connected' once the QR is scanned (PairSuccess webhook)
      updated_at: new Date().toISOString(),
    }

    const { error: dbError } = existing
      ? await supabase.from('whatsapp_config').update(row).eq('account_id', accountId)
      : await supabase
          .from('whatsapp_config')
          // user_id is NOT NULL (audit column, see migration 001) — same
          // "config owner" convention the Meta save path uses.
          .insert({ ...row, account_id: accountId, user_id: userId })

    if (dbError) {
      console.error('[whatsapp/evolution POST] db write failed:', dbError)
      return NextResponse.json(
        { error: 'Instance created but failed to save configuration' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, instance_uuid: instanceUuid })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select(
        'id, provider, evolution_api_url, evolution_admin_token, evolution_instance_uuid'
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (config?.provider === 'evolution' && config.evolution_instance_uuid) {
      try {
        const apiUrl = config.evolution_api_url as string
        const adminToken = decrypt(config.evolution_admin_token as string)
        const instanceUuid = config.evolution_instance_uuid as string
        await logoutInstance({ apiUrl, adminToken, instanceUuid })
        await deleteInstance({ apiUrl, adminToken, instanceUuid })
      } catch (err) {
        // Best-effort — an unreachable/already-gone remote instance must
        // not block clearing the local config.
        console.warn(
          '[whatsapp/evolution DELETE] remote instance cleanup failed (continuing):',
          err instanceof Error ? err.message : err
        )
      }
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)

    if (deleteError) {
      console.error('[whatsapp/evolution DELETE] db delete failed:', deleteError)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
