import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

// ============================================================
// /api/email/templates — CRUD de templates HTML (email_templates).
//   GET    lista los templates del account (agent+) — nombre + subject,
//          sin body_html (la UI lo carga por id para editar).
//   POST   crea o actualiza un template por (account_id, name) (owner).
//          upsert con onConflict — mismo estándar que config.
//   DELETE —/api/email/templates/[id] (owner) en archivo hermana.
// ============================================================

export async function GET() {
  try {
    const ctx = await requireRole('agent')
    const { data, error } = await ctx.supabase
      .from('email_templates')
      .select('id, name, subject, body_html, updated_at')
      .eq('account_id', ctx.accountId)
      .order('name')
    if (error) {
      return NextResponse.json({ error: 'could not list templates' }, { status: 500 })
    }
    return NextResponse.json({ templates: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'bad body' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const bodyHtml = typeof body.body_html === 'string' ? body.body_html : ''
    if (!name || !subject || !bodyHtml) {
      return NextResponse.json(
        { error: 'name, subject and body_html are required' },
        { status: 400 },
      )
    }

    const { error } = await ctx.supabase.from('email_templates').upsert(
      { account_id: ctx.accountId, name, subject, body_html: bodyHtml },
      { onConflict: 'account_id,name' },
    )
    if (error) {
      return NextResponse.json({ error: 'could not save template' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')
    const id = new URL(req.url).searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    const { error } = await ctx.supabase
      .from('email_templates')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
    if (error) {
      return NextResponse.json({ error: 'could not delete template' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}