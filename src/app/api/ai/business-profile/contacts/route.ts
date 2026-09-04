import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { listContacts, createContact, isAccountMember } from '@/lib/ai/business-profile/service'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/business-profile/contacts  (viewer+)
 * All contacts (active and inactive) for the account.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const contacts = await listContacts(supabase, accountId)
    return NextResponse.json({ contacts })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/business-profile/contacts  (admin+)
 * Creates one internal contact. `department_id` is optional — a contact
 * can exist with no department (Parte 7: "un contacto puede existir sin
 * departamento"). `linked_user_id` is optional too — most contacts are
 * business-directory entries, not CRM logins.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`business-profile-contact-create:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    }

    // Punto 9, H9-1 — a non-empty linked_user_id must be a member of
    // THIS account (else a handoff routed to this contact would assign
    // — and notify — a stranger; see handOffToHuman() in auto-reply.ts
    // and service.ts's isAccountMember doc). An empty/absent value
    // means "no CRM login linked" — the existing, legitimate default.
    const rawLinkedUserId =
      typeof body.linked_user_id === 'string' ? body.linked_user_id.trim() : ''
    let linkedUserId: string | null = null
    if (rawLinkedUserId) {
      if (!(await isAccountMember(supabase, accountId, rawLinkedUserId))) {
        return bad('linked_user_id must be a member of this account')
      }
      linkedUserId = rawLinkedUserId
    }

    const contact = await createContact(supabase, accountId, {
      name,
      departmentId: typeof body.department_id === 'string' ? body.department_id : null,
      roleTitle: typeof body.role_title === 'string' ? body.role_title : null,
      phone: typeof body.phone === 'string' ? body.phone : null,
      whatsapp: typeof body.whatsapp === 'string' ? body.whatsapp : null,
      email: typeof body.email === 'string' ? body.email : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
      active: typeof body.active === 'boolean' ? body.active : undefined,
      sortOrder: typeof body.sort_order === 'number' ? body.sort_order : undefined,
      linkedUserId,
    })
    return NextResponse.json({ success: true, contact })
  } catch (err) {
    return toErrorResponse(err)
  }
}
