export type FlowVariableType =
  "string" | "number" | "boolean" | "json" | "contact" | "message";

export interface FlowVariableDeclaration {
  key: string;
  type: FlowVariableType;
  required?: boolean;
  /** Defaults are exportable only when the author explicitly opts out. */
  sensitive?: boolean;
  default?: unknown;
}

export function initializeFlowVariables(
  declarations: readonly FlowVariableDeclaration[],
): Record<string, unknown> {
  const missingRequired = declarations.find(
    (declaration) => declaration.required && declaration.default === undefined,
  );
  if (missingRequired) {
    throw new Error(
      `required variable "${missingRequired.key}" has no initial value`,
    );
  }
  return Object.fromEntries(
    declarations.flatMap((declaration) =>
      declaration.default === undefined
        ? []
        : [[declaration.key, structuredClone(declaration.default)]],
    ),
  );
}

export type CoercionResult =
  { ok: true; value: unknown } | { ok: false; reason: string };

export function coerceDeclaredValue(
  type: FlowVariableType,
  input: unknown,
): CoercionResult {
  if (type === "string") {
    return typeof input === "string"
      ? { ok: true, value: input }
      : { ok: false, reason: "expected_string" };
  }
  if (type === "number") {
    const value =
      typeof input === "number"
        ? input
        : typeof input === "string" && input.trim() !== ""
          ? Number(input)
          : Number.NaN;
    return Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false, reason: "expected_finite_number" };
  }
  if (type === "boolean") {
    if (typeof input === "boolean") return { ok: true, value: input };
    if (input === "true") return { ok: true, value: true };
    if (input === "false") return { ok: true, value: false };
    return { ok: false, reason: "expected_boolean" };
  }
  if (type === "json") {
    if (typeof input === "string") {
      try {
        return { ok: true, value: JSON.parse(input) };
      } catch {
        return { ok: false, reason: "expected_json" };
      }
    }
    if (input !== undefined) return { ok: true, value: input };
    return { ok: false, reason: "expected_json" };
  }
  if (input && typeof input === "object") return { ok: true, value: input };
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === "object") {
        return { ok: true, value: parsed };
      }
    } catch {
      // Fall through to the typed failure below.
    }
  }
  return { ok: false, reason: `expected_${type}` };
}

export type SwitchOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "present"
  | "absent"
  | "greater_than"
  | "greater_or_equal"
  | "less_than"
  | "less_or_equal";

export interface SwitchCase {
  id: string;
  operator: SwitchOperator;
  value?: unknown;
  next: string;
}

export const NUMERIC_SWITCH_OPERATORS = [
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal",
] as const satisfies readonly SwitchOperator[];

export function evaluateLoopExitPredicate(
  subject: unknown,
  operator: SwitchOperator,
  value?: unknown,
): boolean {
  if (
    (NUMERIC_SWITCH_OPERATORS as readonly SwitchOperator[]).includes(operator)
  ) {
    if (
      typeof subject !== "number" ||
      !Number.isFinite(subject) ||
      typeof value !== "number" ||
      !Number.isFinite(value)
    ) {
      throw new Error("Numeric loop operators require finite numeric operands.");
    }
  }
  return evaluateSwitch(subject, [
    { id: "loop_exit", operator, value, next: "done" },
  ]) !== null;
}

export function evaluateSwitch(
  subject: unknown,
  cases: readonly SwitchCase[],
): string | null {
  for (const entry of cases) {
    let matches = false;
    switch (entry.operator) {
      case "equals":
        matches = subject === entry.value;
        break;
      case "not_equals":
        matches = subject !== entry.value;
        break;
      case "contains":
        matches =
          typeof subject === "string" &&
          typeof entry.value === "string" &&
          subject.includes(entry.value);
        break;
      case "present":
        matches = subject !== undefined && subject !== null && subject !== "";
        break;
      case "absent":
        matches = subject === undefined || subject === null || subject === "";
        break;
      case "greater_than":
        matches =
          typeof subject === "number" &&
          typeof entry.value === "number" &&
          subject > entry.value;
        break;
      case "greater_or_equal":
        matches =
          typeof subject === "number" &&
          typeof entry.value === "number" &&
          subject >= entry.value;
        break;
      case "less_than":
        matches =
          typeof subject === "number" &&
          typeof entry.value === "number" &&
          subject < entry.value;
        break;
      case "less_or_equal":
        matches =
          typeof subject === "number" &&
          typeof entry.value === "number" &&
          subject <= entry.value;
        break;
    }
    if (matches) return entry.next;
  }
  return null;
}

export const MAX_COLLECT_INPUT_REGEX_LENGTH = 256;
export const MAX_COLLECT_INPUT_LENGTH = 4_096;

/**
 * JavaScript does not expose a safe-regex engine, so authored expressions use
 * a deliberately small linear subset with no repetition or alternation.
 */
export function isSafeCollectInputRegex(pattern: string): boolean {
  if (!pattern || pattern.length > MAX_COLLECT_INPUT_REGEX_LENGTH) return false;
  if (/\\[1-9]/.test(pattern)) return false;
  // Deliberately tiny linear subset: anchors, literals, escapes and character
  // classes only. No repetition, optionality, grouping or alternation reaches
  // V8's backtracking engine.
  let escaped = false;
  let inClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "[" && !inClass) {
      inClass = true;
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (inClass) continue;
    if ("()*+?{}|".includes(char)) return false;
  }
  if (inClass || escaped) return false;
  try {
    void new RegExp(pattern, "u");
    return true;
  } catch {
    return false;
  }
}

export function validateCollectedInput(
  value: string,
  validation: "any" | "email" | "phone" | "regex" = "any",
  pattern?: string,
): boolean {
  if (!value.trim() || value.length > MAX_COLLECT_INPUT_LENGTH) return false;
  if (validation === "any") return true;
  if (validation === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
  }
  if (validation === "phone") {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15;
  }
  if (!pattern || !isSafeCollectInputRegex(pattern)) return false;
  return new RegExp(pattern, "u").test(value);
}
