// ============================================================
// Mensagem recuperada (chegou em `@lid` sem telefone e o telefone foi achado
// depois): ela entra como mensagem NOVA ou como HISTÓRIA?
//
// Puro, sem I/O. É a decisão mais sensível da correção — ver
// docs/PLANO-lid-sem-telefone.md, 4.3.
//
//   nova       passa pelo caminho normal de ingestão, motores inclusive.
//   historica  só entra no fio, no lugar do carimbo. Nenhum motor.
//
// ⚠️⚠️ Por que `nova` EXISTE (e não "recuperada nunca dispara motor"): a cópia
// que o celular reenvia e a cópia normal da MESMA mensagem disputam o
// `UNIQUE (conversation_id, message_id)`. Se a recuperada nunca disparasse e
// chegasse primeiro, a cópia normal seria descartada como duplicata e os
// motores não rodariam para aquela mensagem — regressão em relação a hoje,
// quando a recuperada é jogada fora e a normal roda tudo. Com `nova`, quem
// chega primeiro recebe o tratamento completo, UMA vez: no caminho normal o
// insert vem antes dos motores, e só quem ganhou o insert os dispara.
//
// ⚠️⚠️ Por que `historica` NÃO dispara nada: o robô leria a mensagem antiga
// DEPOIS das mais novas (um menu consumiria a resposta errada), a IA
// responderia a algo de horas atrás, e a automação de boas-vindas sairia
// depois de gente já ter respondido.
// ============================================================

/**
 * Até quanto tempo depois do envio a recuperada ainda é "a mensagem que
 * acabou de chegar". 5 min é o limiar do alarme de atraso de entrega (1002,
 * que acende ACIMA dele): a `nova` chama `registrarEntrega`, e com este teto
 * ela nunca acende aquele alarme sozinha.
 */
export const IDADE_MAXIMA_DA_NOVA_MS = 5 * 60_000;

export type ModoDaRecuperada = 'nova' | 'historica';

export function modoDaRecuperada(args: {
  /** O carimbo do WhatsApp da mensagem recuperada, em ms. */
  carimboMs: number;
  agoraMs: number;
  /**
   * O `created_at` da mensagem mais recente da conversa, em ms. `null` =
   * conversa SEM mensagem nenhuma (resposta do banco, não ignorância: quem
   * não conseguiu ler escolhe `historica` sem perguntar aqui).
   */
  ultimaDaConversaMs: number | null;
}): ModoDaRecuperada {
  const { carimboMs, agoraMs, ultimaDaConversaMs } = args;
  // Alguém — cliente, equipe ou robô — já escreveu DEPOIS dela: é história.
  // `>=` e não `>`: o carimbo do WhatsApp vem em SEGUNDOS, e a rajada do
  // cliente empata no mesmo segundo; empate é "continua sendo a última".
  const ehAUltima = ultimaDaConversaMs === null || carimboMs >= ultimaDaConversaMs;
  if (!ehAUltima) return 'historica';
  return agoraMs - carimboMs <= IDADE_MAXIMA_DA_NOVA_MS ? 'nova' : 'historica';
}
