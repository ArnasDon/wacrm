import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { toErrorResponse } from '@/lib/auth/errors'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'

// ============================================================
// /api/ccc/entregaveis — carregar / editar / aprovar o pacote gerado.
//
// GET  ?diagnostico_id=...  → o entregável mais recente daquele diagnóstico
//                             (pra a tela /ccc/revisar abrir já com o pacote).
// PATCH { entregavel_id, conteudo_md?, status? }
//                           → salva a edição do texto e/ou aprova o pacote.
//
// Escreve via service role. A rota é protegida por sessão no middleware
// (todo /api/ccc/* exige usuário logado, exceto o cron de acompanhamento) e,
// em cada handler, por requirePlatformAdmin() — só o consultor usa o console.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export async function GET(req: Request) {
  // Só o consultor (platform admin) usa o console da CCC. A rota roda com
  // service role (lê e grava em qualquer conta), então estar logado não basta.
  try {
    await requirePlatformAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  const { searchParams } = new URL(req.url)
  const diagnosticoId = searchParams.get('diagnostico_id') || ''
  if (!diagnosticoId) {
    return NextResponse.json(
      { error: 'diagnostico_id é obrigatório.' },
      { status: 400 },
    )
  }

  const { data, error } = await admin()
    .from('ccc_entregaveis')
    .select('id, conteudo_md, status, aprovado_em, created_at')
    .eq('diagnostico_id', diagnosticoId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ entregavel: null })

  return NextResponse.json({
    entregavel: {
      id: data.id,
      conteudo_md: data.conteudo_md,
      status: data.status ?? 'rascunho',
      aprovado_em: data.aprovado_em ?? null,
    },
  })
}

export async function PATCH(req: Request) {
  // Só o consultor (platform admin) usa o console da CCC. A rota roda com
  // service role (lê e grava em qualquer conta), então estar logado não basta.
  try {
    await requirePlatformAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await req.json().catch(() => null)
  const entregavelId =
    body && typeof body.entregavel_id === 'string' ? body.entregavel_id : ''
  if (!entregavelId) {
    return NextResponse.json(
      { error: 'entregavel_id é obrigatório.' },
      { status: 400 },
    )
  }

  const patch: Record<string, unknown> = {}
  if (typeof body.conteudo_md === 'string') patch.conteudo_md = body.conteudo_md
  if (body.status === 'aprovado' || body.status === 'rascunho') {
    patch.status = body.status
    patch.aprovado_em =
      body.status === 'aprovado' ? new Date().toISOString() : null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 })
  }

  const { data, error } = await admin()
    .from('ccc_entregaveis')
    .update(patch)
    .eq('id', entregavelId)
    .select('id, conteudo_md, status, aprovado_em')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    entregavel: {
      id: data.id,
      conteudo_md: data.conteudo_md,
      status: data.status ?? 'rascunho',
      aprovado_em: data.aprovado_em ?? null,
    },
  })
}
