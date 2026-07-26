import { describe, expect, it } from "vitest";

import {
  boundDebugExecutionPayload,
  boundFlowExecutionPayload,
} from "./execution-payload";

const byteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

describe("flow execution persistence bounds", () => {
  it("replaces oversized production JSON with an explicit object sentinel", () => {
    const bounded = boundFlowExecutionPayload({
      body: "x".repeat(70_000),
    });

    expect(bounded).toMatchObject({
      truncated: true,
      reason: "payload_exceeded_limit",
      original_bytes: expect.any(Number),
    });
    expect(byteLength(bounded)).toBeLessThanOrEqual(61_440);
  });

  it("preserves small payloads without mutating them", () => {
    const source = { nested: { ok: true } };
    const bounded = boundFlowExecutionPayload(source);

    expect(bounded).toEqual(source);
    expect(bounded).not.toBe(source);
  });

  it("uses a shape-safe array sentinel for oversized simulated effects", () => {
    const bounded = boundDebugExecutionPayload(
      [{ body: "x".repeat(40_000) }],
      "array",
    );

    expect(bounded).toEqual([
      expect.objectContaining({
        truncated: true,
        reason: "payload_exceeded_limit",
      }),
    ]);
    expect(byteLength(bounded)).toBeLessThanOrEqual(32_768);
  });
});
