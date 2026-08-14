import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { findChat } from '@/lib/whatsapp/uazapi-api'
import { resolveUazapiPlatformCredentials } from '@/lib/whatsapp/uazapi-platform-config'

// ============================================================
// ONE-OFF ADMIN BACKFILL — not linked from any UI.
//
// Fixes contacts that were created as WhatsApp groups/communities
// BEFORE migration 047 (the `contacts.kind` column) existed. Those
// rows are stuck at kind='individual' with whatever wrong name/photo
// they picked up from a stray message sender — the webhook route
// only classifies chats going forward, it never rewrites an existing
// contact's kind (see 047's migration comment).
//
// This route: finds contacts that look like a WhatsApp group JID
// (numeric phone > 15 digits, or starting with uazapi's group-id
// prefix "120363"), looks up the chat's real name/photo via uazapi's
// POST /chat/find, and updates kind + name + avatar_url in place.
//
// Delete this file once the backfill has been run — it's meant to be
// used once via a manual GET request with the secret below, not kept
// around as a standing endpoint.
// ============================================================

const ADMIN_SECRET = 'bf-groups-8f2c91a6d3e047b1'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  if (searchParams.get('key') !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = supabaseAdmin()

  // Filtered in JS rather than via a PostgREST `.or()` pattern — simpler
  // to get right than escaping a length-based LIKE, and this table is
  // small enough that a full scan of kind='individual' rows is cheap.
  const { data: candidates, error: candidatesError } = await supabase
    .from('contacts')
    .select('id, account_id, name, phone, avatar_url, kind')
    .eq('kind', 'individual')

  if (candidatesError) {
    return NextResponse.json({ error: candidatesError.message }, { status: 500 })
  }

  const groupLike = (candidates ?? []).filter(
    (c: { phone: string }) => c.phone.startsWith('120363') || c.phone.replace(/\D/g, '').length > 15,
  )

  const results: Array<{ id: string; oldName: string; newName?: string; status: string }> = []

  // Cache uazapi config + baseUrl per account so a group-heavy account
  // doesn't redo the same lookups.
  const configCache = new Map<string, { uazapi_token: string } | null>()
  let baseUrl: string | null = null
  try {
    baseUrl = (await resolveUazapiPlatformCredentials()).baseUrl
  } catch (err) {
    return NextResponse.json({ error: `resolveUazapiPlatformCredentials failed: ${String(err)}` }, { status: 500 })
  }

  for (const contact of groupLike as Array<{
    id: string
    account_id: string
    name: string | null
    phone: string
    avatar_url: string | null
    kind: string
  }>) {
    try {
      if (!configCache.has(contact.account_id)) {
        const { data: config } = await supabase
          .from('whatsapp_config')
          .select('uazapi_token')
          .eq('account_id', contact.account_id)
          .eq('provider', 'uazapi')
          .maybeSingle()
        configCache.set(contact.account_id, config ?? null)
      }
      const config = configCache.get(contact.account_id)
      if (!config?.uazapi_token) {
        results.push({ id: contact.id, oldName: contact.name ?? '', status: 'skipped: no uazapi_token for account' })
        continue
      }

      const chatInfo = await findChat({
        baseUrl: baseUrl!,
        token: decrypt(config.uazapi_token),
        chatId: `${contact.phone}@g.us`,
      })

      const newName = chatInfo?.wa_name || chatInfo?.name || contact.name || contact.phone
      const newAvatar = chatInfo?.imagePreview || chatInfo?.image || contact.avatar_url || null

      const { error: updateError } = await supabase
        .from('contacts')
        .update({ kind: 'group', name: newName, avatar_url: newAvatar, updated_at: new Date().toISOString() })
        .eq('id', contact.id)

      if (updateError) {
        results.push({ id: contact.id, oldName: contact.name ?? '', status: `update failed: ${updateError.message}` })
      } else {
        results.push({ id: contact.id, oldName: contact.name ?? '', newName, status: 'updated' })
      }
    } catch (err) {
      results.push({ id: contact.id, oldName: contact.name ?? '', status: `error: ${String(err)}` })
    }
  }

  return NextResponse.json({ scanned: groupLike.length, results })
}
