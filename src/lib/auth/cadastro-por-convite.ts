// ============================================================
// Cadastro por convite — as partes puras da rota
// `POST /api/invitations/[token]/cadastro`.
//
// Por que existe
// --------------
// Com o cadastro público FECHADO no Supabase (Authentication → Sign In /
// Providers → "Allow new users to sign up" desligado), `auth.signUp` do
// navegador passa a ser recusado com `signup_disabled` — e era por ele que
// o link de convite criava a conta de quem ainda não tinha uma. A conta
// nova passa a nascer no SERVIDOR, pela API de administração (que não é
// barrada pela opção), só depois de o convite ser conferido, e sai da rota
// já DENTRO da equipe — o convite é aceito na mesma requisição (ver a
// rota). Assim o cadastro fica fechado para quem chega sem convite, e quem
// tem um link válido entra na equipe que convidou, nunca numa conta avulsa.
//
// ⚠️ A conta nasce com o e-mail CONFIRMADO (`email_confirm: true`). O
// convite é a credencial: quem tem o link é quem foi convidado, e
// confirmar por e-mail exigiria um SMTP que a instalação pode não ter —
// o padrão do Supabase só entrega a quem é da equipe do projeto. O preço é
// que o e-mail digitado não é provado: quem digita errado não recebe a
// recuperação de senha, e quem tem o link pode ocupar o e-mail de outra
// pessoa (o que a confirmação automática, ligada nesta instalação, já
// permitia antes).
// ============================================================

/** O que a rota aceita, já limpo. */
export interface PedidoDeCadastro {
  nome: string
  email: string
  senha: string
}

/** Códigos que a rota devolve e a tela traduz. */
export type CodigoDoCadastro =
  | 'dados_invalidos'
  | 'convite_invalido'
  | 'email_existe'
  | 'senha_fraca'
  | 'falhou'

/** Tetos de tamanho — o bcrypt do Supabase ignora além de 72 bytes. */
export const TETO_NOME = 200
export const TETO_EMAIL = 320
export const SENHA_MINIMA = 6
export const SENHA_MAXIMA = 72

// Forma mínima: algo@algo.algo, sem espaço. A régua de verdade é a do
// Supabase (`email_address_invalid`); esta só barra o óbvio antes da ida.
const FORMA_DE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Lê o corpo do pedido. Devolve `null` para qualquer coisa fora da forma:
 * campo ausente, tipo errado, vazio depois de aparar, grande demais.
 */
export function lerPedidoDeCadastro(corpo: unknown): PedidoDeCadastro | null {
  if (!corpo || typeof corpo !== 'object') return null
  const { nome, email, senha } = corpo as Record<string, unknown>
  if (typeof nome !== 'string' || typeof email !== 'string' || typeof senha !== 'string') {
    return null
  }
  const nomeLimpo = nome.trim()
  const emailLimpo = email.trim().toLowerCase()
  if (!nomeLimpo || nomeLimpo.length > TETO_NOME) return null
  if (emailLimpo.length > TETO_EMAIL || !FORMA_DE_EMAIL.test(emailLimpo)) return null
  // A senha NÃO é aparada: espaço é caractere de senha.
  if (senha.length < SENHA_MINIMA || new TextEncoder().encode(senha).length > SENHA_MAXIMA) {
    return null
  }
  return { nome: nomeLimpo, email: emailLimpo, senha }
}

/**
 * Traduz o erro de `auth.admin.createUser` num código da tela, com o
 * status HTTP. Só o `code` do erro é lido — a mensagem do Supabase é em
 * inglês e não vai para a tela.
 */
export function erroDoCadastro(erro: { code?: string; status?: number } | null): {
  codigo: CodigoDoCadastro
  status: number
} {
  const code = erro?.code
  if (code === 'email_exists' || code === 'user_already_exists') {
    return { codigo: 'email_existe', status: 409 }
  }
  if (code === 'weak_password') return { codigo: 'senha_fraca', status: 400 }
  if (code === 'email_address_invalid' || code === 'validation_failed') {
    return { codigo: 'dados_invalidos', status: 400 }
  }
  return { codigo: 'falhou', status: 500 }
}
