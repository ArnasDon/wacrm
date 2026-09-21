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
 * está") — MENOS para o card PERDIDO, que volta aberto (1028, decisão do
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
 * `statusAntes` é o do card ANTES do update; `statusPedido`, o que o MESMO
 * update grava explicitamente (ausente = não mexe no status). Os dois
 * existem porque o gatilho só reabre quando o update NÃO trocou o status:
 * perdido → etapa neutra continuando perdido volta aberto; quem pediu outra
 * coisa junto fica com o que pediu.
 */
export function statusAoEntrarNaEtapa(
  stages: Pick<PipelineStage, "id" | "resultado">[],
  stageId: string,
  statusAntes: string | null | undefined,
  statusPedido?: string | null,
): DealStatus | null {
  const etapa = stages.find((s) => s.id === stageId);
  const carimbo = statusPorResultado(etapa?.resultado);
  if (carimbo) return carimbo;
  // Etapa desconhecida aqui = não se sabe se é neutra: não afirma nada (o
  // gatilho também só reabre com a etapa achada).
  if (!etapa) return null;
  const depois = statusPedido ?? statusAntes;
  if (statusAntes === "lost" && depois === "lost") return "open";
  return null;
}
