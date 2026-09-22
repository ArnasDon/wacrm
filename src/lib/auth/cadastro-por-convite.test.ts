import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { erroDoCadastro, lerPedidoDeCadastro } from './cadastro-por-convite'

describe('lerPedidoDeCadastro', () => {
  const bom = { nome: '  Ana Exemplo ', email: ' Ana@Exemplo.COM ', senha: ' segredo ' }

  it('apara nome e e-mail, põe o e-mail em minúsculas e NÃO apara a senha', () => {
    expect(lerPedidoDeCadastro(bom)).toEqual({
      nome: 'Ana Exemplo',
      email: 'ana@exemplo.com',
      senha: ' segredo ',
    })
  })

  it.each([
    ['corpo nulo', null],
    ['corpo que não é objeto', 'texto'],
    ['nome ausente', { email: 'a@b.co', senha: '123456' }],
    ['nome só de espaço', { ...bom, nome: '   ' }],
    ['nome longo demais', { ...bom, nome: 'x'.repeat(201) }],
    ['e-mail sem arroba', { ...bom, email: 'ana.exemplo.com' }],
    ['e-mail com espaço no meio', { ...bom, email: 'ana @exemplo.com' }],
    ['senha curta', { ...bom, senha: '12345' }],
    ['senha acima de 72 bytes', { ...bom, senha: 'é'.repeat(37) }],
    ['senha que não é texto', { ...bom, senha: 123456 }],
  ])('recusa %s', (_, corpo) => {
    expect(lerPedidoDeCadastro(corpo)).toBeNull()
  })

  it('aceita senha de exatamente 72 bytes', () => {
    expect(lerPedidoDeCadastro({ ...bom, senha: 'a'.repeat(72) })).not.toBeNull()
  })
})

describe('erroDoCadastro', () => {
  it.each([
    ['email_exists', 'email_existe', 409],
    ['user_already_exists', 'email_existe', 409],
    ['weak_password', 'senha_fraca', 400],
    ['email_address_invalid', 'dados_invalidos', 400],
    ['validation_failed', 'dados_invalidos', 400],
    ['unexpected_failure', 'falhou', 500],
    [undefined, 'falhou', 500],
  ])('%s → %s (%i)', (code, codigo, status) => {
    expect(erroDoCadastro({ code })).toEqual({ codigo, status })
  })

  it('erro nulo é falha genérica, nunca sucesso', () => {
    expect(erroDoCadastro(null)).toEqual({ codigo: 'falhou', status: 500 })
  })
})

// Pino estrutural: com convite, a tela TEM de passar pela rota do servidor
// e SAIR antes de qualquer `auth.signUp`. Se o ramo do convite voltar a cair
// no signUp do navegador, o convite quebra no instante em que o cadastro
// público estiver fechado no Supabase — sem erro nenhum no CI.
describe('tela de cadastro', () => {
  const fonte = readFileSync(
    join(process.cwd(), 'src/app/(auth)/signup/page.tsx'),
    'utf8',
  )

  it('com convite, chama a rota de cadastro e SAI antes do auth.signUp', () => {
    const handler = fonte.indexOf('const handleSignup')
    const ramo = fonte.indexOf('if (inviteToken) {', handler)
    const signUp = fonte.indexOf('supabase.auth.signUp(', handler)
    expect(handler).toBeGreaterThan(-1)
    expect(ramo).toBeGreaterThan(handler)
    expect(signUp).toBeGreaterThan(ramo)
    const trecho = fonte.slice(ramo, signUp)
    expect(trecho).toContain('await cadastrarPorConvite(inviteToken)')
    // o `return` é o que impede o ramo do convite de seguir para o signUp
    expect(trecho).toMatch(/\n\s{6}return;\n\s{4}\}/)
    expect(fonte).toContain('/api/invitations/${encodeURIComponent(token)}/cadastro')
  })

  it('adota a sessão devolvida pela rota, sem segundo login com a senha', () => {
    expect(fonte).toContain('supabase.auth.setSession(')
    expect(fonte).not.toContain('signInWithPassword(')
  })

  it('traduz o cadastro fechado em vez de mostrar a mensagem crua', () => {
    expect(fonte).toContain('error.code === "signup_disabled"')
  })
})
