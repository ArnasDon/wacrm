import { describe, expect, it } from "vitest";
import { shouldOpenTouchToolbar } from "./context-menu";

describe("shouldOpenTouchToolbar", () => {
  it("opens the toolbar on a touch long-press", () => {
    expect(shouldOpenTouchToolbar({ pointerType: "touch", coarsePointer: true, onLink: false })).toBe(true);
  });

  it("leaves a mouse right-click to the native menu", () => {
    expect(shouldOpenTouchToolbar({ pointerType: "mouse", coarsePointer: false, onLink: false })).toBe(false);
  });

  it("leaves a mouse right-click to the native menu on a touchscreen laptop", () => {
    expect(shouldOpenTouchToolbar({ pointerType: "mouse", coarsePointer: true, onLink: false })).toBe(false);
  });

  it("leaves a pen right-click to the native menu", () => {
    expect(shouldOpenTouchToolbar({ pointerType: "pen", coarsePointer: false, onLink: false })).toBe(false);
  });

  it("leaves a long-press on a link to the native menu", () => {
    expect(shouldOpenTouchToolbar({ pointerType: "touch", coarsePointer: true, onLink: true })).toBe(false);
  });

  it("falls back to the device's primary pointer when no pointer was seen", () => {
    expect(shouldOpenTouchToolbar({ pointerType: null, coarsePointer: true, onLink: false })).toBe(true);
    expect(shouldOpenTouchToolbar({ pointerType: null, coarsePointer: false, onLink: false })).toBe(false);
  });
});
