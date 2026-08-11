import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { AiError } from '@/lib/ai/types'
import { DEFAULT_GOLDEN_SET, CATALOG_GOLDEN_SET } from '@/lib/ai/eval/golden-set'
import { runEvalSuite } from '@/lib/ai/eval/run'
import {
  DEFAULT_CUSTOMER_PERSONAS,
  CATALOG_CUSTOMER_PERSONAS,
  simulateCustomerConversation,
} from '@/lib/ai/eval/simulate-customer'
import { createFixtureTools } from '@/lib/ai/eval/fixture-tools'

const ALL_CASES = [...DEFAULT_GOLDEN_SET, ...CATALOG_GOLDEN_SET]
const ALL_PERSONAS = [...DEFAULT_CUSTOMER_PERSONAS, ...CATALOG_CUSTOMER_PERSONAS]
const CATALOG_PERSONA_IDS = new Set(CATALOG_CUSTOMER_PERSONAS.map((p) => p.id))

/**
 * POST /api/ai/eval/run-one — runs exactly one golden case or customer
 * simulation, using the account's own configured AI key, and returns
 * its result. Never accepts case content from the client — only an id,
 * resolved against the known, fixed sets — so a caller can trigger real
 * spend on the account's key but never redirect it at arbitrary text.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-eval-run:${accountId}`, RATE_LIMITS.aiEvalAccount)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const kind = body?.kind
    const id = typeof body?.id === 'string' ? body.id : ''
    if (kind !== 'case' && kind !== 'persona') {
      return NextResponse.json({ error: 'kind must be "case" or "persona".' }, { status: 400 })
    }
    if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })

    const db = supabaseAdmin()
    const config = await loadAiConfig(db, accountId).catch(() => {
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        { error: 'Configure primeiro o agente de IA.', code: 'ai_not_configured' },
        { status: 409 },
      )
    }

    console.info('[ai eval] run-one:', { accountId, userId, kind, id })

    if (kind === 'case') {
      const goldenCase = ALL_CASES.find((c) => c.id === id)
      if (!goldenCase) return NextResponse.json({ error: 'Unknown case id.' }, { status: 404 })
      const suite = await runEvalSuite(config, [goldenCase])
      return NextResponse.json({ kind, result: suite.cases[0] })
    }

    const persona = ALL_PERSONAS.find((p) => p.id === id)
    if (!persona) return NextResponse.json({ error: 'Unknown persona id.' }, { status: 404 })
    const fixture = CATALOG_PERSONA_IDS.has(id) ? createFixtureTools() : null
    const result = await simulateCustomerConversation(config, persona, {
      tools: fixture?.tools,
      executeTool: fixture?.executeTool,
    })
    return NextResponse.json({
      kind,
      result: { ...result, toolCalls: fixture?.recordedCalls() ?? [] },
    })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
