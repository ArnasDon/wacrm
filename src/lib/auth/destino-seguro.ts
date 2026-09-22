// ============================================================
// Para onde `/auth/callback` pode mandar o navegador depois de trocar o
// código do e-mail por uma sessão.
//
// ⚠️ O `next` chega pela URL do e-mail de recuperação, e nada impede
// alguém de montar à mão `…/auth/callback?code=<o dele>&next=https://
// phishing.example`. Redirecionar para lá entregaria um navegador
// RECÉM-AUTENTICADO a um site de terceiro, com a barra de endereço
// saindo do nosso domínio no meio do fluxo de trocar senha — que é
// exatamente o momento em que a pessoa está disposta a digitar uma. É o
// open redirect clássico, e o custo de fechá-lo é esta função.
//
// A régua é a ORIGEM RESOLVIDA, não o formato do texto. Medido no Node:
// `//evil.com`, `/\evil.com` e `https://evil.com` resolvem todos para
// outra origem, e `javascript:alert(1)` resolve para origem `null` — as
// quatro formas que uma checagem por prefixo (`startsWith('/')`) deixa
// passar. Comparar a origem pega todas de uma vez.
// ============================================================

/** Para onde vai quem chega sem `next`, ou com um `next` recusado. */
export const DESTINO_PADRAO = '/dashboard'

/** Base sintética: só serve para resolver o caminho e comparar a origem. */
const BASE = 'https://destino.invalido.local'

/**
 * Caractere de controle nunca é legítimo num caminho nosso e é o que
 * engana parser de cabeçalho quando este valor vira `Location:`. Barra
 * invertida também não: o navegador a normaliza para barra, então
 * `/\evil.com` VIRA `//evil.com` na hora de resolver.
 */
const PROIBIDOS = /[\u0000-\u001f\u007f\\]/

/**
 * Devolve um caminho relativo seguro deste mesmo site, ou
 * `DESTINO_PADRAO` quando o valor recebido não é um.
 */
export function destinoSeguro(bruto: string | null | undefined): string {
  if (!bruto) return DESTINO_PADRAO

  const valor = bruto.trim()
  if (!valor) return DESTINO_PADRAO
  if (PROIBIDOS.test(valor)) return DESTINO_PADRAO

  // Caminho RELATIVO não é recusado por insegurança — `../etc` resolve
  // para `/etc`, na nossa própria origem — e sim porque nada neste
  // projeto gera um: todo `next` que escrevemos começa com barra. Um
  // valor fora dessa forma é engano ou tentativa, e nos dois casos o
  // destino padrão é a resposta certa. Exigir a barra também torna a
  // saída previsível: o que entra é o que sai.
  if (!valor.startsWith('/')) return DESTINO_PADRAO

  let resolvida: URL
  try {
    resolvida = new URL(valor, BASE)
  } catch {
    return DESTINO_PADRAO
  }

  // A prova: resolveu para a NOSSA base, e não para outro host (nem para
  // a origem `null` de um esquema como `javascript:` ou `data:`).
  if (resolvida.origin !== BASE) return DESTINO_PADRAO

  // ⚠️ E a SAÍDA não pode começar com `//`. Um segmento de ponto some na
  // normalização: `/.//evil.example`, `/..//evil.example` e as formas
  // `%2e` resolvem contra a base SEM sair dela (a conferência acima passa)
  // e deixam o caminho `//evil.example` — que, resolvido de novo contra a
  // origem pública na hora do redirecionamento, é URL relativa ao
  // protocolo e aponta para OUTRO host. Achado da revisão do PR #254.
  if (resolvida.pathname.startsWith('//')) return DESTINO_PADRAO

  return `${resolvida.pathname}${resolvida.search}${resolvida.hash}`
}
