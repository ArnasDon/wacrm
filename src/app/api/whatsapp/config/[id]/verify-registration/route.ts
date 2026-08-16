import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getSubscribedApps, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

/**
 * GET /api/whatsapp/config/[id]/verify-registration
 *
 * Diagnostic endpoint — confirms ONE saved phone number is actually
 * reachable on Meta's side. Solves the failure mode that surfaced the
 * original multi-number bug: "UI says Connected but Meta isn't
 * delivering events." Scoped to a single connection (was account-wide
 * before multi-number, back when an account could only have one row).
 *
 * Three checks run independently so the UI can show which step
 * passes and which fails:
 *
 *   1. phone_info  — GET /{phone_number_id} succeeds
 *   2. waba_subscription — our app appears in
 *                    GET /{waba_id}/subscribed_apps
 *   3. registered_at — local timestamp set by PATCH/POST /config when
 *                    /register last succeeded; NULL means the
 *                    number was saved but never actually subscribed
 *
 * Returns 200 in every case so the UI can render diagnostic detail
 * rather than a generic error toast.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { id } = await context.params

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (!config) {
      return NextResponse.json({
        live: false,
        checks: { config_exists: false },
        message: 'Connection not found.',
      })
    }

    if (config.provider === 'zernio') {
      return NextResponse.json({
        live: config.status === 'connected',
        checks: { config_exists: true, zernio_connected: config.status === 'connected' },
        message: 'Zernio-provider connections do not use Meta /register — subscription is managed on Zernio\'s side.',
      })
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return NextResponse.json({
        live: false,
        checks: { config_exists: true, token_decryptable: false },
        message:
          "Stored access token can't be decrypted — likely ENCRYPTION_KEY changed. Re-enter the token to repair.",
      })
    }

    const checks: {
      config_exists: boolean
      token_decryptable: boolean
      phone_metadata_ok: boolean
      waba_subscribed_to_app: boolean | null
      locally_marked_registered: boolean
    } = {
      config_exists: true,
      token_decryptable: true,
      phone_metadata_ok: false,
      waba_subscribed_to_app: null,
      locally_marked_registered: config.registered_at != null,
    }
    const errors: string[] = []

    try {
      await verifyPhoneNumber({ phoneNumberId: config.phone_number_id, accessToken })
      checks.phone_metadata_ok = true
    } catch (err) {
      errors.push(`Phone metadata check failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (config.waba_id) {
      try {
        const subs = await getSubscribedApps({ wabaId: config.waba_id, accessToken })
        checks.waba_subscribed_to_app = subs.length > 0
        if (!checks.waba_subscribed_to_app) {
          errors.push('WABA has no subscribed apps. Re-save the configuration to subscribe.')
        }
      } catch (err) {
        errors.push(`WABA subscription check failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      errors.push("No WABA ID on file — webhooks can't be wired without it. Add it in the form and re-save.")
    }

    const live =
      checks.phone_metadata_ok && (checks.waba_subscribed_to_app ?? false) && checks.locally_marked_registered

    return NextResponse.json({
      live,
      checks,
      errors,
      last_registration_error: config.last_registration_error ?? null,
      registered_at: config.registered_at ?? null,
      subscribed_apps_at: config.subscribed_apps_at ?? null,
    })
  } catch (error) {
    console.error('Error in WhatsApp config/[id]/verify-registration GET:', error)
    return toErrorResponse(error)
  }
}
