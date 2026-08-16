// ============================================================
// Server-only HTTP client for the AI SDR worker's approval-review
// endpoints (GET /api/approvals/pending, POST /api/approvals/decision).
//
// This is the read/decide counterpart to the write-only shim in
// src/lib/eter/aisdr-approval-forward.ts (which forwards WhatsApp
// button taps). Same env vars, same header, same worker — different
// surface: this one powers the "SDR ao vivo" dashboard page instead of
// the WhatsApp webhook.
//
// SECURITY: `APPROVALS_CALLBACK_SECRET` is read here and only here for
// this feature, and only ever touches this server-side module. Callers
// (the two route handlers under src/app/api/eter-agent/aisdr-live/)
// never see it — they call the functions below, not the worker
// directly. The secret must never be interpolated into an error
// message returned to a route caller; every thrown `AiSdrWorkerError`
// in this file is checked against that constraint in
// aisdr-live-client.test.ts.
// ============================================================

const REQUEST_TIMEOUT_MS = 10_000

export class AiSdrWorkerError extends Error {
  /** HTTP status from the AI SDR worker, when the failure came from an
   *  actual response rather than a network/timeout error. */
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AiSdrWorkerError'
    this.status = status
  }
}

function getConfig(): { workerUrl: string; secret: string } {
  const workerUrl = process.env.AI_SDR_WORKER_URL
  const secret = process.env.APPROVALS_CALLBACK_SECRET
  if (!workerUrl || !secret) {
    throw new AiSdrWorkerError(
      'O AI SDR não está configurado neste ambiente (falta AI_SDR_WORKER_URL ou APPROVALS_CALLBACK_SECRET).',
    )
  }
  return { workerUrl, secret }
}

async function callWorker(
  workerUrl: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(`${workerUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new AiSdrWorkerError(
      timedOut
        ? `O AI SDR não respondeu a tempo (${REQUEST_TIMEOUT_MS}ms).`
        : 'Não foi possível contactar o AI SDR. Verifique se o serviço está em funcionamento.',
    )
  }
}

async function assertOk(res: Response): Promise<void> {
  if (res.ok) return
  if (res.status === 401) {
    throw new AiSdrWorkerError(
      'O AI SDR recusou o pedido: o segredo configurado não é válido.',
      401,
    )
  }
  const body = await res.text().catch(() => '')
  throw new AiSdrWorkerError(
    `O AI SDR devolveu um erro inesperado (código ${res.status}).${body ? ` Detalhe: ${body.slice(0, 300)}` : ''}`,
    res.status,
  )
}

// ------------------------------------------------------------
// GET /api/approvals/pending
// ------------------------------------------------------------

export type ApprovalTipo =
  | 'reply'
  | 'whatsapp_reply'
  | 'followup'
  | 'meeting_slot'
  | 'escalation'
  | 'invite_batch'
  | 'whatsapp_batch'

export interface ApprovalLead {
  id: string | number
  nome: string
  empresa?: string | null
}

/** Loosely typed — shape varies by `tipo`, see aisdr-live-presentation.ts
 *  for the narrowing helpers used to render each variant. */
export type ApprovalDetalhes = Record<string, unknown>

export interface PendingApproval {
  id: number
  tipo: ApprovalTipo
  estado: string
  criadoEm: string
  resumo: string
  lead: ApprovalLead | null
  detalhes: ApprovalDetalhes
}

export interface PendingApprovalsResponse {
  ok: boolean
  total: number
  limit: number
  offset: number
  approvals: PendingApproval[]
}

export interface FetchPendingApprovalsOptions {
  limit?: number
  offset?: number
}

export async function fetchPendingApprovals(
  opts: FetchPendingApprovalsOptions = {},
): Promise<PendingApprovalsResponse> {
  const { workerUrl, secret } = getConfig()
  const limit = opts.limit ?? 20
  const offset = opts.offset ?? 0

  const res = await callWorker(
    workerUrl,
    `/api/approvals/pending?limit=${limit}&offset=${offset}`,
    { headers: { 'X-Approvals-Secret': secret } },
  )
  await assertOk(res)
  return (await res.json()) as PendingApprovalsResponse
}

// ------------------------------------------------------------
// POST /api/approvals/decision
// ------------------------------------------------------------

export type ApprovalDecision = 'send' | 'discard'

export interface DecisionResult {
  ok: true
  /** Present when the AI SDR's own idempotency guard resolved this as a
   *  no-op repeat decision on an already-resolved approval. */
  already?: string
}

export async function sendApprovalDecision(
  approvalId: number,
  decision: ApprovalDecision,
): Promise<DecisionResult> {
  const { workerUrl, secret } = getConfig()

  const res = await callWorker(workerUrl, '/api/approvals/decision', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Approvals-Secret': secret,
    },
    body: JSON.stringify({ approval_id: approvalId, decision }),
  })
  await assertOk(res)
  return (await res.json()) as DecisionResult
}
