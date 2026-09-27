import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  inspectChannel,
  parseCredentials,
  phoneNumberConflict,
} from '@/lib/whatsapp/channel-connect'

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

/**
 * POST /api/whatsapp/channels/verify
 *
 * Step one of "Add New Channel": checks the WABA ID, Phone Number ID
 * and access token with Meta without saving anything, and returns what
 * Meta knows about the number so step two can prefill the channel name.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const creds = parseCredentials(body)
    if (creds instanceof NextResponse) return creds

    const conflict = await phoneNumberConflict(supabaseAdmin(), accountId, creds.phoneNumberId)
    if (conflict) return conflict

    const inspected = await inspectChannel(creds)
    if ('response' in inspected) return inspected.response

    return NextResponse.json({ verified: true, ...inspected.snapshot })
  } catch (err) {
    return toErrorResponse(err)
  }
}
