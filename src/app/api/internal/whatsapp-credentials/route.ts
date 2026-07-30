import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption' // ajuste le chemin si le module vit ailleurs

/**
 * Internal-only endpoint — never exposed to the dashboard/browser.
 *
 * Lets n8n (which talks to Supabase directly for everything else,
 * per the shared-Supabase architecture) obtain a WhatsApp access
 * token in USABLE form. `whatsapp_config.access_token` is stored
 * AES-256-GCM-encrypted (see src/lib/whatsapp/encryption.ts) — a
 * direct PostgREST read would hand n8n the ciphertext, which Meta's
 * Graph API rejects with "Cannot parse access token". This route is
 * the only place that calls `decrypt()` on n8n's behalf, so
 * ENCRYPTION_KEY never needs to leave wacrm's process.
 *
 * Auth: shared-secret header (X-Internal-Secret), same pattern as
 * AUTOMATION_CRON_SECRET. Not a customer-facing API key — trusted
 * server-to-server call from n8n only.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret')
  if (!process.env.N8N_INTERNAL_SECRET || secret !== process.env.N8N_INTERNAL_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const accountId = req.nextUrl.searchParams.get('account_id')
  if (!accountId) {
    return NextResponse.json({ error: 'account_id required' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token, catalog_id, waba_id')
    .eq('account_id', accountId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let accessToken: string
  try {
    accessToken = decrypt(data.access_token)
  } catch (e) {
    // Tampered/corrupt ciphertext, or a token that predates ENCRYPTION_KEY
    // being set — fail loudly rather than handing n8n garbage that Meta
    // will reject with a confusing error two hops away.
    console.error(`[whatsapp-credentials] decrypt failed for account ${accountId}:`, e)
    return NextResponse.json({ error: 'decrypt_failed' }, { status: 500 })
  }

  return NextResponse.json({
    phone_number_id: data.phone_number_id,
    access_token: accessToken,
    catalog_id: data.catalog_id,
    waba_id: data.waba_id,
  })
}
