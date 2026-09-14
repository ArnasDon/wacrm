// ============================================================
// Voltar da conversa para a caixa de entrada, no celular, pelo HISTÓRICO do
// navegador.
//
// Pedido do operador (14/09/2026), com o CRM instalado no iPhone: voltar da
// conversa para a lista arrastando da borda esquerda, como no WhatsApp. O
// app instalado já tem esse gesto — mas ele percorre o HISTÓRICO, e a caixa
// de entrada abria a conversa com `router.replace`, sem criar passo nenhum.
// O gesto (e o botão voltar do Android) SAÍA da caixa de entrada em vez de
// fechar a conversa.
//
// A saída não é um arrasto feito à mão em JavaScript: ele disputaria a borda
// da tela com o gesto do próprio sistema. É dar ao sistema o passo que o
// gesto desfaz.
// ============================================================

export type Navegacao = "push" | "replace";

/**
 * Como a URL registra a conversa que acabou de abrir.
 *
 * - No celular, abrindo a partir da LISTA: `push`, o passo que o gesto de
 *   voltar desfaz.
 * - No computador, ou trocando de conversa com outra já aberta: `replace`,
 *   como sempre. No computador lista e conversa convivem na tela, e um passo
 *   por clique faria o botão voltar do navegador percorrer o dia inteiro de
 *   conversas antes de sair da página.
 */
export function navegacaoAoAbrir(p: {
  ehDesktop: boolean;
  haviaConversaAberta: boolean;
}): Navegacao {
  return !p.ehDesktop && !p.haviaConversaAberta ? "push" : "replace";
}

export type AoAndarNoHistorico = "fechar" | "reabrir" | "nada";

/**
 * O que a caixa de entrada faz quando o histórico anda (`popstate`): o gesto
 * de voltar do iPhone, o botão voltar do Android, ou avançar de novo.
 *
 * - URL sem conversa, com uma aberta na tela: `fechar` — voltou para a lista.
 * - URL com uma conversa que não é a da tela: `reabrir`, pelo caminho do deep
 *   link — avançou de novo para a conversa que tinha fechado.
 * - Tela e URL já dizendo a mesma coisa: `nada`.
 */
export function aoAndarNoHistorico(p: {
  conversaNaUrl: string | null;
  conversaAberta: string | null;
}): AoAndarNoHistorico {
  if (p.conversaNaUrl === null) {
    return p.conversaAberta === null ? "nada" : "fechar";
  }
  return p.conversaNaUrl === p.conversaAberta ? "nada" : "reabrir";
}
