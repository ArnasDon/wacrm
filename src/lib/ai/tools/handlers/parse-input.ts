// ============================================================
// Minimal, dependency-free validation for tool call `input` objects.
// The provider already validates against the JSON Schema in
// `additionalProperties: false` / `required` (best-effort, model-side —
// see schema.ts), but handlers still can't trust the shape blindly:
// providers vary in how strictly they enforce schemas, and a
// hallucinated or malformed argument must produce a clean tool error,
// never a thrown exception that skips `is_error` handling.
// ============================================================

export class ToolInputError extends Error {}

export function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key]
  if (typeof v !== 'string' || !v.trim()) {
    throw new ToolInputError(`Falta o argumento obrigatório "${key}".`)
  }
  return v
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key]
  return typeof v === 'string' && v.trim() ? v : undefined
}

export function requireIsoDate(input: Record<string, unknown>, key: string): Date {
  const raw = requireString(input, key)
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    throw new ToolInputError(`O argumento "${key}" não é uma data ISO 8601 válida: "${raw}".`)
  }
  return date
}

export function optionalIsoDate(input: Record<string, unknown>, key: string): Date | undefined {
  const raw = optionalString(input, key)
  if (!raw) return undefined
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    throw new ToolInputError(`O argumento "${key}" não é uma data ISO 8601 válida: "${raw}".`)
  }
  return date
}

export function optionalInteger(input: Record<string, unknown>, key: string): number | undefined {
  const v = input[key]
  if (v === undefined || v === null) return undefined
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) {
    throw new ToolInputError(`O argumento "${key}" tem de ser um número inteiro.`)
  }
  return Math.floor(n)
}

export function optionalEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const v = input[key]
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
  throw new ToolInputError(`O argumento "${key}" tem de ser um de: ${allowed.join(', ')}.`)
}
