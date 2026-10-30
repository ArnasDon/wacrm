export interface ContextMenuOrigin {
  pointerType: string | null;
  coarsePointer: boolean;
  onLink: boolean;
}

export function shouldOpenTouchToolbar({ pointerType, coarsePointer, onLink }: ContextMenuOrigin): boolean {
  if (onLink) return false;
  if (pointerType) return pointerType === "touch";
  return coarsePointer;
}
