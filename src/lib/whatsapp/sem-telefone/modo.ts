// ============================================================
// Mensagem recuperada (chegou em `@lid` sem telefone e o telefone foi achado
// depois): como ela entra?
//
// Puro, sem I/O. É a decisão mais sensível da correção — ver
// docs/PLANO-lid-sem-telefone.md, 4.3.
//
//   nova       é a ÚLTIMA da conversa e acabou de ser enviada: passa pelo
//              caminho normal de ingestão, motores inclusive.
//   tardia     é a ÚLTIMA da conversa, mas chegou tarde demais para os
//              motores: entra como história E a conversa passa a refleti-la
//              (reabre se estava encerrada, prévia, posição na lista).
//   historica  alguém já escreveu depois dela: só entra no fio, no lugar do
//              carimbo. Nenhum motor, e a conversa não se mexe.
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
// ⚠️⚠️ Por que `tardia` e `historica` NÃO disparam nada: o robô leria a
// mensagem antiga DEPOIS das mais novas (um menu consumiria a resposta
// errada), a IA responderia a algo de horas atrás, e a automação de
// boas-vindas sairia depois de gente já ter respondido.
//
// ⚠️⚠️ Por que `tardia` EXISTE (revisão por duas lentes, 19/09/2026): a cópia
// do celular depende de o aparelho estar acordado, então pode chegar horas
// depois. Tratada como `historica` pura, a fala de um cliente cuja conversa
// estava ENCERRADA entrava sem reabrir, sem prévia e sem subir na lista —
// visível só para quem abrisse a aba Encerradas. O argumento da histórica
// ("reabrir desfaria um encerramento decidido com informação mais nova") não
// vale quando NÃO EXISTE nada mais novo do que ela: quem encerrou o fez sem
// ver a mensagem.
// ============================================================

/**
 * Até quanto tempo depois do envio a recuperada ainda é "a mensagem que
 * acabou de chegar".
 *
 * ⚠️ 4 min, e não os 5 do alarme de atraso de entrega (1002, que acende ACIMA
 * de 300 s): a `nova` chama `registrarEntrega`, que mede o atraso DEPOIS —
 * passados a espera de 2 s do `jaGravada` e as consultas do caminho. Com o
 * teto colado no limiar, a cópia que chegasse aos 4:58 acendia "conexão
 * entregando com atraso" numa conexão sadia. Há teste cobrando a folga.
 */
export const IDADE_MAXIMA_DA_NOVA_MS = 4 * 60_000;

export type ModoDaRecuperada = 'nova' | 'tardia' | 'historica';

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
  return agoraMs - carimboMs <= IDADE_MAXIMA_DA_NOVA_MS ? 'nova' : 'tardia';
}
