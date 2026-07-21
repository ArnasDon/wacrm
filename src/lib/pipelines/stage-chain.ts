export const MAX_STAGE_CHAIN_DEPTH = 3;

export function getStageChainDepth(context?: { vars?: Record<string, unknown> }): number {
  const raw = context?.vars?._stage_chain_depth;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}
