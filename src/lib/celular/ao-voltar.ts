// ============================================================
// Recarregar a tela quando a pessoa VOLTA para o app.
//
// O CRM instalado na Tela de Início não tem botão de recarregar nem "puxar
// para atualizar" (14/09/2026). A caixa de entrada já se atualizava ao
// voltar (o `visibilitychange` da página do inbox); Tarefas, Meu dia, Funil e
// Contatos não — quem saía para o WhatsApp e voltava uma hora depois via a
// lista de uma hora atrás, sem aviso nenhum.
// ============================================================

/**
 * Tempo fora mínimo para recarregar. Abaixo disso é olhada rápida em outro
 * app: recarregar a cada troca queimaria consulta (o funil busca todos os
 * negócios do quadro) para trazer o que mudou em segundos.
 */
export const AUSENCIA_QUE_RECARREGA_MS = 30_000;

/**
 * Voltou depois de tempo fora suficiente para a tela poder estar velha?
 *
 * `saiuEm` nulo é "não vi a saída" (a tela montou já visível): não recarrega.
 * Relógio andando para trás (acerto de hora no aparelho) também não.
 */
export function voltouDepoisDeAusencia(
  saiuEm: number | null,
  agoraMs: number,
  minimoMs: number = AUSENCIA_QUE_RECARREGA_MS,
): boolean {
  return saiuEm !== null && agoraMs - saiuEm >= minimoMs;
}
