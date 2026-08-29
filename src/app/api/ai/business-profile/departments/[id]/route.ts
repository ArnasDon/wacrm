import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { updateDepartment, deleteDepartment } from '@/lib/ai/business-profile/service'

/** PATCH /api/ai/business-profile/departments/[id]  (admin+) */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`business-profile-department-update:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const department = await updateDepartment(supabase, accountId, id, {
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      description: 'description' in body ? (typeof body.description === 'string' ? body.description : null) : undefined,
      active: typeof body.active === 'boolean' ? body.active : undefined,
      sortOrder: typeof body.sort_order === 'number' ? body.sort_order : undefined,
    })
    return NextResponse.json({ success: true, department })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/ai/business-profile/departments/[id]  (admin+) —
 *  contacts that belonged to it are NOT deleted (ON DELETE SET NULL,
 *  migration 050); they just become department-less. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`business-profile-department-delete:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    await deleteDepartment(supabase, accountId, id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
