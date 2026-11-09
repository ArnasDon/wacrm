import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/sso?token_hash=...&next=/inbox
 *
 * Login único do Sistema iBox (sistema.crmwga.com). O sistema, já com a
 * pessoa logada, gera no servidor um passe de uso único (magic link sem
 * envio de e-mail, válido por poucos minutos) para o MESMO e-mail dela no
 * CRM e abre esta rota. Aqui o passe é trocado por uma sessão normal do CRM.
 *
 * Nenhuma senha passa por aqui. Passe inválido, vencido ou já usado cai no
 * login normal do CRM. `next` só aceita caminhos internos (começando com "/").
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const nextParam = searchParams.get('next') ?? '/inicio'
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/inicio'

  if (tokenHash) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' })
    if (!error) return NextResponse.redirect(`${origin}${next}`)
    console.error('[api/sso] verifyOtp falhou:', error.message)
  }

  return NextResponse.redirect(`${origin}/login`)
}
