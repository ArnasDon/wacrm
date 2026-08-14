import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  listResources,
  createResource,
  deleteResource,
  AppointmentError,
} from '@/lib/appointments/queries'

// ============================================================
// GET/POST/DELETE /api/appointments/resources — salas/recurso mínimo
//
// GET    — lista salas del account
// POST   — crea sala { name } (agent+)
// DELETE — ?id= borra sala (admin+)
// ============================================================

export async function GET() {
  try {
    const ctx = await requireRole('agent')
    const resources = await listResources(ctx.accountId)
    return NextResponse.json({ resources })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = (await request.json()) as { name?: unknown }
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    const resource = await createResource(ctx.accountId, body.name.trim())
    return NextResponse.json({ resource }, { status: 201 })
  } catch (err) {
    if (err instanceof AppointmentError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    await deleteResource(ctx.accountId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AppointmentError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}