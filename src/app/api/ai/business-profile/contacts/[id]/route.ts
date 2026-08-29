import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { updateContact, deleteContact } from '@/lib/ai/business-profile/service'

/** PATCH /api/ai/business-profile/contacts/[id]  (admin+) */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`business-profile-contact-update:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const contact = await updateContact(supabase, accountId, id, {
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      departmentId: 'department_id' in body ? (typeof body.department_id === 'string' ? body.department_id : null) : undefined,
      roleTitle: 'role_title' in body ? (typeof body.role_title === 'string' ? body.role_title : null) : undefined,
      phone: 'phone' in body ? (typeof body.phone === 'string' ? body.phone : null) : undefined,
      whatsapp: 'whatsapp' in body ? (typeof body.whatsapp === 'string' ? body.whatsapp : null) : undefined,
      email: 'email' in body ? (typeof body.email === 'string' ? body.email : null) : undefined,
      notes: 'notes' in body ? (typeof body.notes === 'string' ? body.notes : null) : undefined,
      active: typeof body.active === 'boolean' ? body.active : undefined,
      sortOrder: typeof body.sort_order === 'number' ? body.sort_order : undefined,
      linkedUserId:
        'linked_user_id' in body ? (typeof body.linked_user_id === 'string' ? body.linked_user_id : null) : undefined,
    })
    return NextResponse.json({ success: true, contact })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE /api/ai/business-profile/contacts/[id]  (admin+) */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`business-profile-contact-delete:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    await deleteContact(supabase, accountId, id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
