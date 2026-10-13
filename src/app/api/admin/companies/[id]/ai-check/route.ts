import { NextResponse } from 'next/server'
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { cleanTranscript, runPlaygroundTurn } from '@/lib/ai/playground'
import { AiError } from '@/lib/ai/types'
import type { TurnResult } from '@/lib/onboarding/ai-check'

/**
 * POST /api/admin/companies/[id]/ai-check  { messages }  (platform admin)
 *
 * One Playground turn against a company's AI, for the scripted pre-launch
 * check in /admin. One turn per request keeps each call under the proxy
 * timeout even on slow models; the browser drives the scenarios. Uses
 * the company's own AI key. Never touches WhatsApp or the database.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePlatformAdmin()
    const { id } = await params
    const body = await request.json().catch(() => null)
    const messages = cleanTranscript(body?.messages)
    if (!messages?.length || messages[messages.length - 1].role !== 'user') {
      return NextResponse.json({ error: 'messages must end with a user turn' }, { status: 400 })
    }

    const g = await runPlaygroundTurn(platformAdminClient(), id, messages)
    const result: TurnResult = {
      reply: g.text,
      handoff: g.handoff,
      reservations: g.reservationProposals ?? [],
      contactName: g.contactName,
      appointment: g.appointmentProposal != null,
      banner: g.sendCategoryBannerName,
      photo: g.sendPhotoProductName,
      catalog: g.sendCatalog,
    }
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
