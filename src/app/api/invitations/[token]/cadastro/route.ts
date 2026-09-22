// ============================================================
// POST /api/invitations/[token]/cadastro
//
// Público — quem chama ainda não tem conta. Cria a conta de quem recebeu
// um convite VÁLIDO e, na MESMA requisição, aceita o convite: a pessoa sai
// daqui já dentro da equipe que convidou, com a sessão devolvida para a
// tela adotar. Com o cadastro público fechado no Supabase, é o único jeito
// de uma conta nova nascer.
//
// Por que aceitar aqui, e não deixar o "Aceitar" da tela /join
// ------------------------------------------------------------
// `handle_new_user` dá a TODO usuário novo uma conta própria, da qual ele é
// dono. Criando a conta sem aceitar, um link ainda não aceito criaria
// várias contas avulsas — cada uma um CRM inteiro dentro da instância,
// capaz de conectar WhatsApp na Evolution do escritório —, e quem não
// clicasse em "Aceitar" ficaria com uma delas. "Só por convite" passaria a
// ser "para quem tem um link". Achado da revisão independente (22/09/2026).
//
// A aceitação é o MESMO `redeem_invitation` da tela /join (trava o convite
// com FOR UPDATE, move o perfil e apaga a conta avulsa), chamado com o JWT
// da pessoa recém-criada — nada de caminho paralelo com a service role.
//
// Se a aceitação falhar, a conta criada aqui é DESFEITA (a conta avulsa e
// o usuário, criados segundos antes nesta mesma requisição), para a pessoa
// poder tentar de novo com o mesmo e-mail. Se desfazer falhar, o usuário é
// BLOQUEADO (ban). Se não der para saber se o convite foi aceito (o banco
// não responde), nada é apagado e nada é declarado: a tela leva a pessoa a
// /join/<token>.
//
// ⚠️ O que fica sem cobertura, por escrito: resposta do createUser perdida
// no caminho, ou o processo morrendo entre o createUser e o desfazer —
// sobra uma conta avulsa sem ninguém saber. O convite continua pendente
// (a pessoa pode aceitá-lo por /join), e o login avulso aparece em
// Authentication → Users para ser bloqueado.
//
// Ver `src/lib/auth/cadastro-por-convite.ts` para o porquê do e-mail
// confirmado na criação.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient as criarClienteSupabase } from '@supabase/supabase-js'

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

  const admin = supabaseAdmin()
  const { data: criado, error } = await admin.auth.admin.createUser({
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
  const novoId = criado.user?.id
  if (!novoId) {
    console.error('[cadastro por convite] createUser sem id de usuário')
    return NextResponse.json({ codigo: 'falhou' }, { status: 500 })
  }

  // Entra como a pessoa, só nesta requisição e sem guardar nada: a sessão
  // serve para o redeem rodar com o `auth.uid()` dela, e depois vai para a
  // tela, que a adota (uma sessão só, nada pendurado).
  const semPersistir = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const { data: entrada, error: erroAoEntrar } = await criarClienteSupabase(
    url,
    anon,
    semPersistir,
  ).auth.signInWithPassword({ email: pedido.email, password: pedido.senha })
  const sessao = entrada?.session
  if (erroAoEntrar || !sessao) {
    console.error('[cadastro por convite] entrar como a conta nova falhou:', erroAoEntrar?.code)
    await desfazerConta(admin, novoId)
    return NextResponse.json({ codigo: 'falhou' }, { status: 500 })
  }

  const comoEla = criarClienteSupabase(url, anon, {
    ...semPersistir,
    global: { headers: { Authorization: `Bearer ${sessao.access_token}` } },
  })
  const { error: erroDoAceite } = await comoEla.rpc('redeem_invitation', {
    p_token_hash: tokenHash,
  })
  if (erroDoAceite) {
    console.error('[cadastro por convite] redeem falhou:', erroDoAceite.code)
    // O erro pode ter vindo DEPOIS do commit (resposta perdida no caminho):
    // se o perfil já saiu da conta avulsa, o convite foi aceito, e desfazer
    // agora apagaria um membro da equipe. Quem decide é o banco.
    const estado = await estadoDoAceite(admin, novoId)
    const desfecho = estado === 'pendente' ? await desfazerConta(admin, novoId) : estado
    if (desfecho === 'aceito') return sucesso(sessao)
    if (desfecho === 'incerto') {
      // Não dá para saber se o convite foi aceito. Não se apaga nada (pode
      // ser um membro) e não se declara sucesso (pode ser uma conta avulsa):
      // a tela adota a sessão e leva a pessoa a /join/<token>, que mostra
      // "Aceitar" se o convite ainda estiver pendente.
      return NextResponse.json(
        { codigo: 'aceite_incerto', sessao: tokensDa(sessao) },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    // 22023 = convite não existe, já usado ou vencido (usado por outra
    // pessoa entre a conferência e o aceite, por exemplo).
    return erroDoAceite.code === '22023'
      ? NextResponse.json({ codigo: 'convite_invalido' }, { status: 400 })
      : NextResponse.json({ codigo: 'falhou' }, { status: 500 })
  }

  return sucesso(sessao)
}

type Sessao = { access_token: string; refresh_token: string }

function tokensDa(sessao: Sessao): Sessao {
  return { access_token: sessao.access_token, refresh_token: sessao.refresh_token }
}

function sucesso(sessao: Sessao) {
  return NextResponse.json(
    { ok: true, sessao: tokensDa(sessao) },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}

type Admin = ReturnType<typeof supabaseAdmin>
type EstadoDoAceite = 'aceito' | 'pendente' | 'incerto'

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Onde está o perfil da pessoa? Fora de uma conta de que ela é dona, o
 * `redeem` o moveu: `aceito`. Na conta avulsa (ou sem perfil — o gatilho
 * falhou), nada foi aceito: `pendente`. Leitura que falha é `incerto`, e
 * NUNCA vira nem "aceito" (declararia sucesso sobre uma conta avulsa) nem
 * "pendente" (apagaria um possível membro). Tenta de novo antes de desistir.
 */
async function estadoDoAceite(admin: Admin, userId: string): Promise<EstadoDoAceite> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    if (tentativa > 0) await esperar(150 * tentativa)
    const estado = await lerEstadoDoAceite(admin, userId)
    if (estado !== 'incerto') return estado
  }
  return 'incerto'
}

async function lerEstadoDoAceite(admin: Admin, userId: string): Promise<EstadoDoAceite> {
  const { data: perfil, error } = await admin
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return 'incerto'
  if (!perfil?.account_id) return 'pendente'
  const { data: conta, error: erroDaConta } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', perfil.account_id)
    .maybeSingle()
  if (erroDaConta || !conta) return 'incerto'
  return conta.owner_user_id === userId ? 'pendente' : 'aceito'
}

/**
 * Desfaz a conta criada nesta requisição: a conta avulsa (que leva o perfil
 * e o campo de e-mail junto, em cascata — o mesmo DELETE que o `redeem`
 * faz com ela) e depois o usuário. `accounts.owner_user_id` é RESTRICT, por
 * isso a ordem.
 *
 * ⚠️ Se o DELETE não achar conta avulsa nenhuma, o usuário só é apagado
 * depois de conferir que o perfil não foi para a equipe: um `redeem` ainda
 * em voo quando o erro de transporte chegou apaga a conta avulsa sozinho, e
 * apagar o usuário ali tiraria da equipe quem acabou de entrar.
 *
 * Falha de escrita cai no bloqueio (ban): a conta nunca fica solta.
 */
async function desfazerConta(
  admin: Admin,
  userId: string,
): Promise<'desfeito' | 'bloqueado' | EstadoDoAceite> {
  const { data: apagadas, error: erroDaConta } = await admin
    .from('accounts')
    .delete()
    .eq('owner_user_id', userId)
    .select('id')
  if (erroDaConta) return bloquear(admin, userId, erroDaConta.code)

  if ((apagadas?.length ?? 0) === 0) {
    const estado = await estadoDoAceite(admin, userId)
    if (estado !== 'pendente') return estado
  }

  const { error: erroDoUsuario } = await admin.auth.admin.deleteUser(userId)
  if (erroDoUsuario) return bloquear(admin, userId, erroDoUsuario.code)
  return 'desfeito'
}

async function bloquear(admin: Admin, userId: string, motivo?: string): Promise<'bloqueado'> {
  console.error('[cadastro por convite] desfazer falhou; bloqueando o usuário:', motivo)
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
  if (error) {
    console.error(
      '[cadastro por convite] ⚠️ bloqueio também falhou — conta avulsa solta, usuário',
      userId,
      error.code,
    )
  }
  return 'bloqueado'
}
