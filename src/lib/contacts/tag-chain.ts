export const MAX_TAG_CHAIN_DEPTH = 3;

export function getTagChainDepth(context?: {
  vars?: Record<string, unknown>;
}): number {
  const raw = context?.vars?._tag_chain_depth;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
    ? Math.floor(raw)
    : 0;
}
