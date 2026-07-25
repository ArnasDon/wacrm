export interface CopilotDraftGate {
  draft: {
    generation_id: string;
    verified: boolean;
    issues: readonly unknown[];
  } | null;
  hasPendingQuestion: boolean;
  lastTurnKind: 'draft' | 'question' | null;
}

export interface CopilotInputKeydownState {
  key: string;
  isComposing: boolean;
  sending: boolean;
  creating: boolean;
  value: string;
}

export function canCreateCopilotDraft(draft: CopilotDraftGate | null): boolean {
  return (
    draft !== null &&
    draft.draft !== null &&
    draft.hasPendingQuestion === false &&
    draft.lastTurnKind === 'draft' &&
    draft.draft.verified === true &&
    draft.draft.issues.length === 0 &&
    draft.draft.generation_id.trim().length > 0
  );
}

export function shouldSendCopilotMessageFromKeydown(
  state: CopilotInputKeydownState,
): boolean {
  return (
    state.key === 'Enter' &&
    state.isComposing === false &&
    state.sending === false &&
    state.creating === false &&
    state.value.trim().length > 0
  );
}
