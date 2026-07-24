// ============================================================
// GET /l/[slug]
//
// Public redirect for a tracked link (migration 040). No auth — this
// is the URL an ad, a landing page, or a printed flyer points at.
//
//   1. Look up the link by slug (service-role client; RLS has no
//      anonymous-visitor concept to grant here).
//   2. Bump its click counter, best-effort.
//   3. 302 to wa.me/<number>?text=<message + [#slug] tag>.
//
// The tag is what lets the webhook (src/app/api/whatsapp/webhook/
// route.ts) attribute the resulting WhatsApp message back to this
// link when the customer sends the pre-filled text unedited — see
// src/lib/attribution/ref-token.ts for the format and why it has to
// be short and visually inert (the customer sees it in their message
// box before hitting send).
//
// Unknown slug -> redirect to the app's own homepage rather than a
// bare 404: a stale/mistyped link should degrade to "somewhere real"
// instead of a dead end, and we never want to hand back an error page
// that might leak which slugs *do* exist via timing/response shape.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { buildPrefilledMessage } from '@/lib/attribution/ref-token'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

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

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://wacrm.tech'
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params

  const ip = getClientIp(request)
  const limit = checkRateLimit(`trackedLink:${ip}`, RATE_LIMITS.trackedLinkRedirect)
  if (!limit.success) {
    // A 302 to the homepage rather than a 429 body — this URL is
    // meant to be clicked by a phone browser, not inspected; a
    // JSON/text error page is a dead end for that visitor.
    return NextResponse.redirect(siteUrl(), 302)
  }

  const { data: link, error } = await supabaseAdmin()
    .from('tracked_links')
    .select('id, whatsapp_number, message_template')
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    console.error('[tracked-link redirect] lookup failed:', error)
  }
  if (!link) {
    return NextResponse.redirect(siteUrl(), 302)
  }

  // Fire-and-forget: a failed click count must never block the
  // redirect the customer is waiting on. Atomic increment (see the
  // migration) rather than a JS read-then-write, which would race two
  // simultaneous clicks right when an ad goes live.
  supabaseAdmin()
    .rpc('increment_tracked_link_clicks', { p_link_id: link.id })
    .then(({ error: rpcError }: { error: unknown }) => {
      if (rpcError) console.error('[tracked-link redirect] click count failed:', rpcError)
    })

  const phone = sanitizePhoneForMeta(link.whatsapp_number)
  const text = buildPrefilledMessage(link.message_template ?? '', slug)
  const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`

  return NextResponse.redirect(waUrl, 302)
}
