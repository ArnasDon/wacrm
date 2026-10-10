import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { toErrorResponse } from '@/lib/auth/errors'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { decrypt } from '@/lib/whatsapp/encryption'

// ============================================================
// POST /api/ccc/criar-templates — cria os templates HSM da CCC na Meta,
// usando o token do canal WhatsApp JÁ conectado no CRM (descriptografado no
// servidor). Exige platform admin (requirePlatformAdmin). Idempotente: se o
// template já existe, a Meta responde e nós apenas reportamos.
//
// Body: { waba_id?, name? }  (defaults: a WABA da CCC; todos os templates)
// ============================================================

const GRAPH = 'https://graph.facebook.com/v22.0'
const WABA_CCC = '824812527258696' // WABA que abriga os templates da CCC

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

interface TemplateDef {
  name: string
  body: string
  example: string[]
}

// Templates da CCC (UTILITY, pt_BR). O motor de cadência usa ccc_toque_cadencia.
const TEMPLATES: TemplateDef[] = [
  {
    name: 'ccc_toque_cadencia',
    body:
      'Oi {{1}}! Chegou a vez do lead *{{2}}* na sua régua ({{3}}).\n\n' +
      'Ação de hoje: {{4}}\n\nJá fez? Marca no CRM. 💪',
    example: [
      'Camila',
      'Grande obra - Gama',
      'D+3',
      'Segundo follow-up com gatilho de prazo/estoque',
    ],
  },
]

export async function POST(req: Request) {
  // Só o consultor (platform admin) usa o console da CCC. A rota roda com
  // service role (lê e grava em qualquer conta), então estar logado não basta.
  try {
    await requirePlatformAdmin()
  } catch (err) {
    return toErrorResponse(err)
  }

  try {
    const body = await req.json().catch(() => ({}))
    const wabaId =
      typeof body?.waba_id === 'string' && body.waba_id ? body.waba_id : WABA_CCC
    const apenas = typeof body?.name === 'string' ? body.name : null

    const { data: canal } = await admin()
      .from('whatsapp_config')
      .select('access_token')
      .eq('waba_id', wabaId)
      .eq('status', 'connected')
      .not('access_token', 'is', null)
      .limit(1)
      .maybeSingle()

    if (!canal?.access_token) {
      return NextResponse.json(
        { error: `Nenhum canal conectado na WABA ${wabaId}.` },
        { status: 404 },
      )
    }

    let token: string
    try {
      token = decrypt(canal.access_token)
    } catch {
      return NextResponse.json(
        { error: 'Falha ao descriptografar o token do canal.' },
        { status: 500 },
      )
    }

    const alvo = apenas ? TEMPLATES.filter((t) => t.name === apenas) : TEMPLATES
    const resultados: unknown[] = []

    for (const t of alvo) {
      const payload = {
        name: t.name,
        language: 'pt_BR',
        category: 'UTILITY',
        components: [
          {
            type: 'BODY',
            text: t.body,
            example: { body_text: [t.example] },
          },
        ],
      }
      const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      resultados.push({
        template: t.name,
        ok: res.ok,
        status: data?.status ?? (res.ok ? 'submitted' : undefined),
        id: data?.id,
        erro: res.ok
          ? undefined
          : data?.error?.error_user_msg ??
            data?.error?.message ??
            `http_${res.status}`,
      })
    }

    return NextResponse.json({ ok: true, waba_id: wabaId, resultados })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao criar templates.' },
      { status: 500 },
    )
  }
}
