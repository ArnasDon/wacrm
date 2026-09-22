// ============================================================
// POST /api/invitations/[token]/cadastro
//
// Público — quem chama ainda não tem conta. Cria a conta de quem recebeu
// um convite VÁLIDO, pela API de administração do Supabase, que continua
// funcionando com o cadastro público fechado. A tela `/signup?invite=…`
// chama esta rota no lugar de `auth.signUp`, entra com a senha recém-
// criada e segue para `/join/<token>`, onde a pessoa ACEITA o convite —
// a aceitação continua sendo o `redeem`, com a confirmação de sempre.
//
// O que ela NÃO faz, de propósito
//   - Não aceita o convite. Criar a conta e entrar na equipe são passos
//     separados desde o original: a pessoa vê a conta e o papel antes.
//   - Não consome o convite. Um convite válido ainda pode criar contas
//     até ser aceito — por isso os dois limites abaixo (por IP e por
//     convite). O cadastro aberto de antes criava contas sem limite algum.
//
// Ver `src/lib/auth/cadastro-por-convite.ts` para o porquê do e-mail
// confirmado na criação.
// ============================================================

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { erroDoCadastro, lerPedidoDeCadastro } from '@/lib/auth/cadastro-por-convite'
import { hashInviteToken } from '@/lib/auth/invitations'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(request)
  const porIp = checkRateLimit(`cadastro:${ip}`, RATE_LIMITS.invitationSignup)
  if (!porIp.success) return rateLimitResponse(porIp)

  const { token } = await params
  if (!token || typeof token !== 'string') {
    return NextResponse.json({ codigo: 'convite_invalido' }, { status: 400 })
  }
  const tokenHash = hashInviteToken(token)

  // Por convite: um link vazado não vira fábrica de contas. O teto é
  // folgado para quem erra a senha duas vezes e tenta de novo.
  const porConvite = checkRateLimit(
    `cadastro-convite:${tokenHash}`,
    RATE_LIMITS.invitationSignupPerToken,
  )
  if (!porConvite.success) return rateLimitResponse(porConvite)

  const corpo = await request.json().catch(() => null)
  const pedido = lerPedidoDeCadastro(corpo)
  if (!pedido) {
    return NextResponse.json({ codigo: 'dados_invalidos' }, { status: 400 })
  }

  // O convite é conferido pela MESMA função que a tela `/join` usa: não
  // existe, já usado ou vencido não cria conta nenhuma.
  const supabase = await createClient()
  const { data: convite, error: erroDoConvite } = await supabase.rpc('peek_invitation', {
    p_token_hash: tokenHash,
  })
  if (erroDoConvite) {
    console.error('[cadastro por convite] peek falhou:', erroDoConvite.code, erroDoConvite.message)
    return NextResponse.json({ codigo: 'falhou' }, { status: 500 })
  }
  if (!convite || (convite as { ok?: unknown }).ok !== true) {
    const motivo = (convite as { reason?: unknown } | null)?.reason
    return NextResponse.json(
      { codigo: 'convite_invalido', motivo: typeof motivo === 'string' ? motivo : 'not_found' },
      { status: 400 },
    )
  }

  const { error } = await supabaseAdmin().auth.admin.createUser({
    email: pedido.email,
    password: pedido.senha,
    email_confirm: true,
    // `full_name` é o que o gatilho `handle_new_user` lê para dar nome à
    // conta e ao perfil — o mesmo campo que `auth.signUp` mandava.
    user_metadata: { full_name: pedido.nome },
  })
  if (error) {
    const { codigo, status } = erroDoCadastro(error)
    // Só código e status: a mensagem do Supabase pode repetir o e-mail.
    if (codigo === 'falhou') {
      console.error('[cadastro por convite] createUser falhou:', error.code, error.status)
    }
    return NextResponse.json({ codigo }, { status })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
