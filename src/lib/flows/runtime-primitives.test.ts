import { describe, expect, it } from "vitest";

import {
  coerceDeclaredValue,
  evaluateLoopExitPredicate,
  evaluateSwitch,
  initializeFlowVariables,
  validateCollectedInput,
} from "./runtime-primitives";

describe("coerceDeclaredValue", () => {
  it("uses conservative, explicit coercions", () => {
    expect(coerceDeclaredValue("number", "42.5")).toEqual({
      ok: true,
      value: 42.5,
    });
    expect(coerceDeclaredValue("boolean", "true")).toEqual({
      ok: true,
      value: true,
    });
    expect(coerceDeclaredValue("json", '{"ok":true}')).toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(coerceDeclaredValue("string", 12)).toEqual({
      ok: false,
      reason: "expected_string",
    });
    expect(coerceDeclaredValue("number", "")).toEqual({
      ok: false,
      reason: "expected_finite_number",
    });
    expect(coerceDeclaredValue("boolean", "yes")).toEqual({
      ok: false,
      reason: "expected_boolean",
    });
    expect(coerceDeclaredValue("contact", '{"id":"contact-1"}')).toEqual({
      ok: true,
      value: { id: "contact-1" },
    });
  });
});

describe("evaluateLoopExitPredicate", () => {
  it("compares numeric loop values without string coercion", () => {
    expect(evaluateLoopExitPredicate(12, "greater_than", 10)).toBe(true);
    expect(evaluateLoopExitPredicate(8, "greater_or_equal", 10)).toBe(false);
  });

  it("rejects numeric operators with non-numeric operands", () => {
    expect(() =>
      evaluateLoopExitPredicate("12", "greater_than", 10),
    ).toThrow(/numeric/i);
    expect(() =>
      evaluateLoopExitPredicate(12, "greater_than", "10"),
    ).toThrow(/numeric/i);
  });
});

describe("initializeFlowVariables", () => {
  it("copies typed defaults and rejects a missing required runtime value", () => {
    expect(
      initializeFlowVariables([
        { key: "count", type: "number", default: 0, required: true },
        { key: "email", type: "string", required: false },
        { key: "enabled", type: "boolean", default: false },
      ]),
    ).toEqual({ count: 0, enabled: false });
    expect(() =>
      initializeFlowVariables([
        { key: "email", type: "string", required: true },
      ]),
    ).toThrow('required variable "email"');
  });
});

describe("evaluateSwitch", () => {
  it("returns the first matching case deterministically", () => {
    expect(
      evaluateSwitch("gold-customer", [
        {
          id: "contains",
          operator: "contains",
          value: "gold",
          next: "first",
        },
        {
          id: "equals",
          operator: "equals",
          value: "gold-customer",
          next: "second",
        },
      ]),
    ).toBe("first");
  });

  it("supports typed comparisons and a caller-owned default", () => {
    expect(
      evaluateSwitch(12, [
        { id: "lt", operator: "less_than", value: 10, next: "small" },
        { id: "gte", operator: "greater_or_equal", value: 12, next: "large" },
      ]),
    ).toBe("large");
    expect(evaluateSwitch(undefined, [])).toBeNull();
  });
});

describe("validateCollectedInput", () => {
  it("validates email and normalized E.164-like phone input", () => {
    expect(validateCollectedInput("alice@example.com", "email")).toBe(true);
    expect(validateCollectedInput("alice@", "email")).toBe(false);
    expect(validateCollectedInput("+55 (11) 99999-9999", "phone")).toBe(true);
    expect(validateCollectedInput("123", "phone")).toBe(false);
  });

  it("rejects unsafe or invalid regular expressions", () => {
    expect(
      validateCollectedInput("ABC-12", "regex", "^[A-Z][A-Z][A-Z]-\\d\\d$"),
    ).toBe(true);
    expect(validateCollectedInput("ABC", "regex", "[")).toBe(false);
    expect(validateCollectedInput("aaaaaaaa", "regex", "(a+)+$")).toBe(false);
    expect(validateCollectedInput("aaaaaaaa", "regex", "(a|aa)+$")).toBe(false);
    expect(validateCollectedInput("aaaaaaaa", "regex", "(a?)+$")).toBe(false);
    expect(validateCollectedInput("aaaaaaaa", "regex", "a+a+$")).toBe(false);
    expect(
      validateCollectedInput(
        `${"a".repeat(100)}b`,
        "regex",
        "^a{0,100}a{0,100}a{0,100}b$",
      ),
    ).toBe(false);
    expect(validateCollectedInput("a", "regex", "^a?$")).toBe(false);
    expect(validateCollectedInput("a".repeat(4_097), "regex", "^a+$")).toBe(
      false,
    );
    expect(validateCollectedInput("anything", "regex", "x".repeat(257))).toBe(
      false,
    );
  });
});
