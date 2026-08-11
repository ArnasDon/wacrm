import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { DEFAULT_GOLDEN_SET, CATALOG_GOLDEN_SET } from '@/lib/ai/eval/golden-set'
import { DEFAULT_CUSTOMER_PERSONAS, CATALOG_CUSTOMER_PERSONAS } from '@/lib/ai/eval/simulate-customer'

/**
 * GET /api/ai/eval/cases — metadata only (ids + descriptions), no LLM
 * calls. The UI runs each case/persona individually via
 * POST /api/ai/eval/run-one so it can show real progress and never
 * risk one giant request timing out mid-suite.
 */
export async function GET() {
  try {
    await requireRole('admin')
    return NextResponse.json({
      cases: [...DEFAULT_GOLDEN_SET, ...CATALOG_GOLDEN_SET].map((c) => ({
        id: c.id,
        description: c.description,
        withTools: Boolean(c.withTools),
      })),
      personas: [...DEFAULT_CUSTOMER_PERSONAS, ...CATALOG_CUSTOMER_PERSONAS].map((p) => ({
        id: p.id,
        description: p.description,
        goal: p.goal,
      })),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
