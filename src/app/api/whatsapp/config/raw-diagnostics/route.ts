import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'

// Temporary diagnostic endpoint for the 133010 "Account not registered"
// investigation (2026-08-05). Fires the three raw Graph API GET calls the
// user asked for, using the exact production token, and returns the
// unmodified JSON bodies so the failure signature can be read directly
// off Meta's response rather than inferred from our own error mapping.
// Delete once the registration-state question is resolved.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json({ error: 'No account' }, { status: 400 })
  }

  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!config) {
    return NextResponse.json({ error: 'No config' }, { status: 400 })
  }

  const accessToken = decrypt(config.access_token)
  const V = 'v23.0'

  async function rawGet(path: string) {
    const url = `https://graph.facebook.com/${V}/${path}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const text = await res.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    return { url, httpStatus: res.status, body }
  }

  const [phoneInfo, wabaPhoneNumbers, wabaInfo] = await Promise.all([
    rawGet(
      `${config.phone_number_id}?fields=id,display_phone_number,verified_name,quality_rating,platform_type,name_status,code_verification_status`,
    ),
    config.waba_id ? rawGet(`${config.waba_id}/phone_numbers`) : null,
    config.waba_id ? rawGet(`${config.waba_id}`) : null,
  ])

  return NextResponse.json({
    phone_number_id: config.phone_number_id,
    waba_id: config.waba_id,
    registered_at: config.registered_at,
    last_registration_error: config.last_registration_error,
    calls: {
      phone_info: phoneInfo,
      waba_phone_numbers: wabaPhoneNumbers,
      waba_info: wabaInfo,
    },
  })
}
