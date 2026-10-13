import { NextResponse } from 'next/server'
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { onboardingSecret } from '@/lib/onboarding/secret'

/**
 * GET /api/admin/onboarding  (platform admin only)
 * Setup data for the onboarding Apps Script: the shared secret to paste
 * into its Script Properties and which forms it has registered.
 */
export async function GET() {
  try {
    await requirePlatformAdmin()
    const { data, error } = await platformAdminClient()
      .from('onboarding_forms')
      .select('form_vertical, edit_url, updated_at')
    if (error) throw error
    return NextResponse.json({ secret: onboardingSecret(), forms: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}
