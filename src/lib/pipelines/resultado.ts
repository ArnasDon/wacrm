import type { DealStatus, PipelineStage } from "@/types";

/**
 * Espelho CLIENT-SIDE do gatilho `cb_deals_aplica_resultado` (migration 950).
 *
 * Quem carimba o status de verdade é o BANCO, para qualquer escritor. Este
 * espelho existe só para o estado otimista das telas: depois de mover um
 * negócio para uma etapa marcada, o selo Ganho/Perdido tem de aparecer na
 * hora — sem ele, a tela mostraria "Aberto" até o próximo refetch, e o
 * operador acharia que a regra não funcionou.
 *
 * ⚠️ A regra daqui NÃO pode divergir da do gatilho: etapa 'ganho' → 'won',
 * 'perdido' → 'lost', neutra → NÃO MEXE (devolve null = "mantenha o que
 * está") — MENOS para o card PERDIDO, que volta aberto (1031, decisão do
 * operador em 21/09/2026: o desqualificado pode voltar a ser qualificado).
 * GANHO que sai para etapa neutra continua ganho (2026-08-29): fechou →
 * transferiu para o funil do Jurídico → continua ganho.
 */
export function statusPorResultado(
  resultado: string | null | undefined,
): DealStatus | null {
  if (resultado === "ganho") return "won";
  if (resultado === "perdido") return "lost";
  return null;
}

/**
 * O status que uma mudança PARA `stageId` produz, ou null para "mantém".
 *
 * `statusAntes` é o do card ANTES do update. Os dois chamadores (o arrasto
 * no quadro e a etapa na lista do funil) só mudam a ETAPA, e é esse o caso em
 * que o gatilho reabre: perdido → etapa neutra volta aberto.
 *
 * ⚠️ É só o PALPITE otimista: o `statusAntes` é o da memória da tela, que pode
 * ser de antes de outro operador mexer no card. Os chamadores trocam o
 * palpite pelo status que o BANCO devolve na escrita (Codex, PR #245).
 */
export function statusAoEntrarNaEtapa(
  stages: Pick<PipelineStage, "id" | "resultado">[],
  stageId: string,
  statusAntes: string | null | undefined,
): DealStatus | null {
  const etapa = stages.find((s) => s.id === stageId);
  const carimbo = statusPorResultado(etapa?.resultado);
  if (carimbo) return carimbo;
  // Etapa desconhecida aqui = não se sabe se é neutra: não afirma nada (o
  // gatilho também só reabre com a etapa achada).
  if (!etapa) return null;
  if (statusAntes === "lost") return "open";
  return null;
}
