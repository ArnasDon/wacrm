import { describe, expect, it } from "vitest";

import {
  acceptCanvasCode,
  acceptEditedCode,
  createFlowCodeEditorState,
  keepEditedCode,
  editFlowCode,
  receiveCanvasCode,
  type FlowCodeEditorState,
} from "./flow-code-editor";

const initial = '{\n  "name": "Initial"\n}\n';
const canvasNext = '{\n  "name": "Canvas"\n}\n';
const codeNext = '{\n  "name": "Code"\n}\n';

describe("flow code editor controller", () => {
  it("updates canonical code from canvas when no edit is pending", () => {
    const state = receiveCanvasCode(
      createFlowCodeEditorState(initial, "digest-1"),
      canvasNext,
      "digest-2",
    );

    expect(state.canonicalText).toBe(canvasNext);
    expect(state.editedText).toBe(canvasNext);
    expect(state.origin).toBe("canvas");
    expect(state.conflict).toBe(false);
  });

  it("never overwrites a pending code edit when canvas also changes", () => {
    const edited = editFlowCode(
      createFlowCodeEditorState(initial, "digest-1"),
      codeNext,
    );
    const conflicted = receiveCanvasCode(edited, canvasNext, "digest-2");

    expect(conflicted.editedText).toBe(codeNext);
    expect(conflicted.canonicalText).toBe(initial);
    expect(conflicted.pendingCanvas).toEqual({
      text: canvasNext,
      digest: "digest-2",
    });
    expect(conflicted.conflict).toBe(true);
  });

  it("applies valid code once without feedback loops and keeps invalid diagnostics local", () => {
    const edited = editFlowCode(
      createFlowCodeEditorState(initial, "digest-1"),
      codeNext,
    );
    const invalid: FlowCodeEditorState = {
      ...edited,
      diagnostics: [{ code: "INVALID_JSON", severity: "fatal" }],
    };
    expect(invalid.editedText).toBe(codeNext);
    expect(invalid.canonicalText).toBe(initial);

    const accepted = acceptEditedCode(invalid, codeNext, "digest-code");
    expect(accepted.applyGeneration).toBe(1);
    expect(accepted.canonicalText).toBe(codeNext);
    expect(accepted.editedText).toBe(codeNext);
    expect(accepted.diagnostics).toEqual([]);

    expect(
      acceptEditedCode(accepted, codeNext, "digest-code").applyGeneration,
    ).toBe(1);
  });

  it("surfaces explicit use-code/use-canvas conflict resolution", () => {
    const conflicted = receiveCanvasCode(
      editFlowCode(createFlowCodeEditorState(initial, "digest-1"), codeNext),
      canvasNext,
      "digest-2",
    );

    expect(
      acceptCanvasCode(conflicted).editedText,
    ).toBe(canvasNext);
    expect(
      keepEditedCode(conflicted).editedText,
    ).toBe(codeNext);
    expect(keepEditedCode(conflicted).canonicalText).toBe(initial);
    expect(keepEditedCode(conflicted).conflict).toBe(false);
  });
});
