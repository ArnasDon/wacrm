export interface FlowCodeEditorDiagnostic {
  code: string;
  severity: "warning" | "blocking" | "fatal" | "activation";
  message?: string;
  path?: string;
  candidates?: Array<{ id: string; name: string }>;
}

export interface FlowCodeEditorState {
  canonicalText: string;
  editedText: string;
  digest: string;
  origin: "initial" | "canvas" | "code";
  diagnostics: FlowCodeEditorDiagnostic[];
  pendingCanvas: { text: string; digest: string } | null;
  conflict: boolean;
  /** In-memory only. Never serialize this controller state. */
  sidecars: {
    secretBindings: Map<string, string>;
  };
  /** Monotonic token lets React apply a compiled draft exactly once. */
  applyGeneration: number;
}

export function createFlowCodeEditorState(
  canonicalText: string,
  digest: string,
): FlowCodeEditorState {
  return {
    canonicalText,
    editedText: canonicalText,
    digest,
    origin: "initial",
    diagnostics: [],
    pendingCanvas: null,
    conflict: false,
    sidecars: { secretBindings: new Map() },
    applyGeneration: 0,
  };
}

export function editFlowCode(
  state: FlowCodeEditorState,
  editedText: string,
): FlowCodeEditorState {
  return {
    ...state,
    editedText,
    origin: "code",
    diagnostics: [],
  };
}

export function receiveCanvasCode(
  state: FlowCodeEditorState,
  text: string,
  digest: string,
): FlowCodeEditorState {
  if (digest === state.digest) return state;
  const hasPendingCode = state.editedText !== state.canonicalText;
  if (hasPendingCode) {
    return {
      ...state,
      pendingCanvas: { text, digest },
      conflict: true,
    };
  }
  return {
    ...state,
    canonicalText: text,
    editedText: text,
    digest,
    origin: "canvas",
    diagnostics: [],
    pendingCanvas: null,
    conflict: false,
  };
}

export function withFlowCodeDiagnostics(
  state: FlowCodeEditorState,
  diagnostics: FlowCodeEditorDiagnostic[],
): FlowCodeEditorState {
  return { ...state, diagnostics };
}

export function acceptEditedCode(
  state: FlowCodeEditorState,
  canonicalText: string,
  digest: string,
): FlowCodeEditorState {
  const isAlreadyApplied =
    digest === state.digest &&
    canonicalText === state.canonicalText &&
    !state.conflict;
  return {
    ...state,
    canonicalText,
    editedText: canonicalText,
    digest,
    origin: "code",
    diagnostics: [],
    pendingCanvas: null,
    conflict: false,
    applyGeneration:
      state.applyGeneration + (isAlreadyApplied ? 0 : 1),
  };
}

export function acceptCanvasCode(
  state: FlowCodeEditorState,
): FlowCodeEditorState {
  if (!state.pendingCanvas) return state;
  return {
    ...state,
    canonicalText: state.pendingCanvas.text,
    editedText: state.pendingCanvas.text,
    digest: state.pendingCanvas.digest,
    origin: "canvas",
    diagnostics: [],
    pendingCanvas: null,
    conflict: false,
  };
}

/** Discards only the queued canvas snapshot so debounce can validate code. */
export function keepEditedCode(
  state: FlowCodeEditorState,
): FlowCodeEditorState {
  return {
    ...state,
    pendingCanvas: null,
    conflict: false,
    origin: "code",
  };
}
