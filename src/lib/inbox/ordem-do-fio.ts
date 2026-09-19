// ============================================================
// Onde entra, no fio ABERTO, a mensagem que chegou pelo realtime.
//
// Quase sempre no fim — é a mais nova. Mas mensagem pode ser GRAVADA depois
// de mensagens mais novas que ela: a fala que chegou em `@lid` sem telefone e
// só entrou quando o número apareceu (docs/PLANO-lid-sem-telefone.md), ou o
// lote que uma conexão represada drena fora de ordem (1002). O `created_at`
// dela é o carimbo do WhatsApp; acrescentada ao fim, ela apareceria como a
// última coisa que o cliente disse — logo abaixo de respostas que vieram
// DEPOIS dela — até alguém recarregar a conversa, que lê ordenado do banco.
//
// Puro. Para mensagem em ordem (a regra), o resultado é idêntico a
// `[...lista, nova]`.
// ============================================================

/**
 * ⚠️ Compara INSTANTES, não texto: o realtime e o REST escrevem o mesmo
 * instante com frações diferentes ("…:54+00:00" × "…:54.000000+00:00").
 * Carimbo ilegível cai no fim, como sempre foi.
 */
export function inserirNaOrdem<T extends { created_at: string }>(lista: T[], nova: T): T[] {
  const instante = Date.parse(nova.created_at);
  const ultima = lista.at(-1);
  if (!ultima || Number.isNaN(instante) || instante >= Date.parse(ultima.created_at)) {
    return [...lista, nova];
  }
  // Antes da primeira que é MAIS NOVA que ela — empate fica depois (a ordem
  // de chegada desempata, como no fim da lista).
  const i = lista.findIndex((m) => Date.parse(m.created_at) > instante);
  if (i === -1) return [...lista, nova];
  return [...lista.slice(0, i), nova, ...lista.slice(i)];
}
