import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  sendApprovalDecision,
  AiSdrWorkerError,
  type ApprovalDecision,
} from '@/lib/eter/aisdr-live-client'

// ============================================================
// POST /api/eter-agent/aisdr-live/decision  (admin+)
//
// Internal proxy for the AI SDR worker's POST /api/approvals/decision
// — powers the Aprovar/Descartar buttons on the "SDR ao vivo" dashboard
// page. Same security posture as the sibling pending/route.ts:
// `APPROVALS_CALLBACK_SECRET` stays server-side inside
// aisdr-live-client.ts and is never present in any response this route
// returns.
//
// The AI SDR endpoint is itself idempotent (a repeat decision on an
// already-resolved approval returns `{ ok: true, already: state }`
// rather than an error) — this route just passes that shape through
// unchanged.
// ============================================================

interface DecisionBody {
  approval_id?: unknown
  decision?: unknown
}

function isValidDecision(value: unknown): value is ApprovalDecision {
  return value === 'send' || value === 'discard'
}

export async function POST(request: Request) {
  try {
    await requireRole('admin')

    const body = (await request.json().catch(() => null)) as DecisionBody | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corpo do pedido inválido.' }, { status: 400 })
    }

    const approvalId = body.approval_id
    if (typeof approvalId !== 'number' || !Number.isSafeInteger(approvalId)) {
      return NextResponse.json(
        { error: 'approval_id é obrigatório e deve ser um número inteiro.' },
        { status: 400 },
      )
    }
    if (!isValidDecision(body.decision)) {
      return NextResponse.json(
        { error: 'decision é obrigatório e deve ser "send" ou "discard".' },
        { status: 400 },
      )
    }

    const result = await sendApprovalDecision(approvalId, body.decision)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AiSdrWorkerError) {
      const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 502
      return NextResponse.json({ error: err.message }, { status })
    }
    return toErrorResponse(err)
  }
}
