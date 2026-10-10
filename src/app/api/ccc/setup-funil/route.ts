import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { toErrorResponse } from '@/lib/auth/errors'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { criarFunilPadrao } from '@/lib/ccc/setup-funil'

// ============================================================
// POST /api/ccc/setup-funil — o agente 3R de setup do CRM (o funil).
// Cria o pipeline + etapas numa conta, com a "conversa qualificada" marcada.
// A lógica vive em @/lib/ccc/setup-funil (reusada pela amarração /processar).
//
// Body: { account_id, nome_pipeline?, etapas?: [{ name, is_connection }] }
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

export async function POST(req: Request) {
  // Só o consultor (platform admin) usa o console da CCC. A rota roda com
  // service role (lê e grava em qualquer conta), então estar logado não basta.
  try {
    await requirePlatformAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  try {
    const body = await req.json().catch(() => null)
    const accountId =
      body && typeof body.account_id === 'string' ? body.account_id : ''
    const nomePipeline =
      body && typeof body.nome_pipeline === 'string' ? body.nome_pipeline : undefined
    const etapas =
      body && Array.isArray(body.etapas)
        ? body.etapas.map((e: { name?: string; is_connection?: boolean }) => ({
            name: String(e?.name ?? '').trim(),
            is_connection: Boolean(e?.is_connection),
          }))
        : undefined

    const resultado = await criarFunilPadrao({
      supabase: admin(),
      accountId,
      nomePipeline,
      etapas,
    })

    if (!resultado.ok) {
      const status = resultado.error?.includes('obrigatório') ? 400 : 500
      return NextResponse.json({ error: resultado.error }, { status })
    }

    return NextResponse.json(resultado)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erro ao criar o funil.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
