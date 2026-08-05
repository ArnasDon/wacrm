import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

// ============================================================
// GET /api/email/templates/[id] — carga UN template con su body_html
// (agent+). La lista no incluye el HTML (grande); la UI lo carga aquí
// al abrir el editor (§11, "la UI lo carga por id para editar").
// ============================================================

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await context.params
    const { data, error } = await ctx.supabase
      .from('email_templates')
      .select('id, name, subject, body_html, updated_at')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (error || !data) {
      return NextResponse.json({ error: 'template not found' }, { status: 404 })
    }
    return NextResponse.json({ template: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}