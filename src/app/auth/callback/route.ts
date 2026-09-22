// ============================================================
// /auth/callback — a ponte do e-mail para a sessão.
//
// O Supabase manda a pessoa para cá com um `code` de uso único (fluxo
// PKCE, que é o do `@supabase/ssr`); esta rota o troca por uma sessão em
// cookie e segue para o `next`.
//
// ⚠️ ELA NÃO EXISTIA, e a tela de "esqueci a senha" apontava para cá
// desde o upstream (`forgot-password/page.tsx` pede
// `redirectTo: …/auth/callback?next=/reset-password`). O e-mail chegava,
// o link caía em 404 e não havia caminho nenhum de recuperar senha no
// produto. Quem mexer no `redirectTo` de lá mexe aqui junto.
//
// ⚠️ O `next` passa por `destinoSeguro` — nunca use o valor cru. O
// porquê está no cabeçalho daquele módulo (open redirect com o navegador
// já autenticado).
//
// ⚠️ Esta rota tem de continuar FORA do `protectedPaths` do
// `src/middleware.ts`: quem chega aqui ainda não tem sessão, e protegê-la
// mandaria a pessoa para o login levando o `code` embora — o link do
// e-mail é de uso único, então ela nunca mais conseguiria trocar a senha
// com aquele e-mail.
//
// ⚠️ Os dois redirecionamentos saem da ORIGEM PÚBLICA (`origemPublica`),
// nunca de `request.nextUrl`: em produção aquela origem é
// `https://0.0.0.0:3000`, e até 22/09/2026 esta rota trocava o código pela
// sessão e mandava a pessoa para lá — os cookies ficavam no domínio certo e
// o navegador ia para um endereço que não abre.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'

import { destinoSeguro } from '@/lib/auth/destino-seguro'
import { origemPublica } from '@/lib/auth/origem-publica'
import { createClient } from '@/lib/supabase/server'

/** Para onde volta quem chegou com link vencido, já usado ou adulterado. */
const FALHA = '/forgot-password?erro=link'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const destino = destinoSeguro(request.nextUrl.searchParams.get('next'))
  const origem = origemPublica(request.headers, request.nextUrl)

  const falhar = () => NextResponse.redirect(new URL(FALHA, origem))

  if (!code) return falhar()

  // `createClient()` escreve os cookies da sessão pelo `cookieStore`, e
  // numa Route Handler isso PEGA na resposta (ao contrário de um Server
  // Component, onde o `setAll` é engolido pelo try/catch de lá).
  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return falhar()

  // `destino` já é caminho relativo validado (`destinoSeguro`): resolvido
  // contra a origem pública, não sai dela.
  return NextResponse.redirect(new URL(destino, origem))
}
