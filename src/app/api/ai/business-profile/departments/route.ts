import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { listDepartments, createDepartment } from '@/lib/ai/business-profile/service'

/**
 * GET /api/ai/business-profile/departments  (viewer+)
 * All departments (active and inactive) for the account.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const departments = await listDepartments(supabase, accountId)
    return NextResponse.json({ departments })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/business-profile/departments  (admin+)
 * Creates one department. No fixed/assumed department list — an admin
 * names whatever departments their business actually has.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`business-profile-department-create:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    }

    const department = await createDepartment(supabase, accountId, {
      name,
      description: typeof body.description === 'string' ? body.description : null,
      active: typeof body.active === 'boolean' ? body.active : undefined,
      sortOrder: typeof body.sort_order === 'number' ? body.sort_order : undefined,
    })
    return NextResponse.json({ success: true, department })
  } catch (err) {
    return toErrorResponse(err)
  }
}
