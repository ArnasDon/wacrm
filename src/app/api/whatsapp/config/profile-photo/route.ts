import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  getBusinessProfile,
  updateBusinessProfilePhoto,
  uploadResumableMedia,
} from '@/lib/whatsapp/meta-api'

// Same limits as the template image-header handle (template-header-handle.ts)
// — this goes through the identical Resumable Upload step, subject to the
// same Meta-side constraints.
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png']

async function loadWhatsAppConfig(supabase: SupabaseClient, accountId: string) {
  const { data: config, error } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !config) {
    throw new Error(
      'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
    )
  }
  return config as { phone_number_id: string; access_token: string }
}

/**
 * GET /api/whatsapp/config/profile-photo
 *
 * Returns the photo customers currently see (straight from Meta, not
 * anything cached locally — wacrm never stores this photo itself).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const config = await loadWhatsAppConfig(supabase, accountId)
    const accessToken = decrypt(config.access_token)

    const profile = await getBusinessProfile({
      phoneNumberId: config.phone_number_id,
      accessToken,
    })
    return NextResponse.json({
      profile_picture_url: profile.profile_picture_url ?? null,
    })
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    const message =
      error instanceof Error ? error.message : 'Failed to fetch the current profile photo.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

/**
 * POST /api/whatsapp/config/profile-photo
 *
 * Uploads a new photo via Meta's Resumable Upload API and sets it as
 * the WhatsApp Business Profile photo — the one customers actually see
 * next to messages from this number. Distinct from (and unrelated to)
 * an agent's own wacrm login avatar, which only ever renders inside
 * the CRM's own UI.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const config = await loadWhatsAppConfig(supabase, accountId)
    const accessToken = decrypt(config.access_token)

    const appId = process.env.META_APP_ID
    if (!appId) {
      return NextResponse.json(
        {
          error:
            'META_APP_ID is not set in the environment — required for Meta’s Resumable Upload API.',
        },
        { status: 500 },
      )
    }

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No photo file provided.' }, { status: 400 })
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Photo must be JPEG or PNG (got ${file.type || 'unknown type'}).` },
        { status: 400 },
      )
    }
    if (file.size > IMAGE_MAX_BYTES) {
      return NextResponse.json(
        {
          error: `Photo is ${(file.size / 1024 / 1024).toFixed(1)} MB — Meta's limit is 5 MB.`,
        },
        { status: 400 },
      )
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const fileName = file.type === 'image/png' ? 'profile.png' : 'profile.jpg'

    let handle: string
    try {
      const uploaded = await uploadResumableMedia({
        appId,
        accessToken,
        fileName,
        mimeType: file.type,
        bytes,
      })
      handle = uploaded.handle
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Photo upload to Meta failed.'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    try {
      await updateBusinessProfilePhoto({
        phoneNumberId: config.phone_number_id,
        accessToken,
        handle,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Meta rejected the profile photo update.'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    // Meta can take a short moment to reflect the change back through
    // `profile_picture_url` — the update above already succeeded either
    // way, so a failure here is non-fatal; the UI just won't get an
    // immediate preview and can re-check with GET shortly after.
    let profilePictureUrl: string | null = null
    try {
      const profile = await getBusinessProfile({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
      profilePictureUrl = profile.profile_picture_url ?? null
    } catch {
      // Non-fatal — see comment above.
    }

    return NextResponse.json({ success: true, profile_picture_url: profilePictureUrl })
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return toErrorResponse(error)
    }
    console.error('Error updating WhatsApp business profile photo:', error)
    const message =
      error instanceof Error ? error.message : 'Failed to update the profile photo.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
