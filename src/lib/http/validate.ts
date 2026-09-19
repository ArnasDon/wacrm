import { ValidationError } from './errors'

// ============================================================
// Tiny input validators. Every value from a request body goes
// through one of these before it reaches a query or a document —
// they coerce to the exact primitive type, which is also what
// stops Mongo operator injection (`{"$gt": ""}` is not a string).
// ============================================================

export function str(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; optional?: boolean; trim?: boolean } = {},
): string {
  const { min = 1, max = 500, optional = false, trim = true } = opts
  if (value === undefined || value === null || value === '') {
    if (optional) return ''
    throw new ValidationError(`${field} is required`)
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
  const v = trim ? value.trim() : value
  if (v.length < min && !(optional && v.length === 0)) {
    throw new ValidationError(`${field} must be at least ${min} characters`)
  }
  if (v.length > max) throw new ValidationError(`${field} must be at most ${max} characters`)
  return v
}

export function optStr(value: unknown, field: string, max = 500): string | null {
  const v = str(value, field, { optional: true, max })
  return v === '' ? null : v
}

export function num(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; integer?: boolean; optional?: boolean } = {},
): number {
  const { min = -Infinity, max = Infinity, integer = false, optional = false } = opts
  if ((value === undefined || value === null || value === '') && optional) return NaN
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new ValidationError(`${field} must be a number`)
  }
  if (integer && !Number.isInteger(n)) throw new ValidationError(`${field} must be a whole number`)
  if (n < min) throw new ValidationError(`${field} must be at least ${min}`)
  if (n > max) throw new ValidationError(`${field} must be at most ${max}`)
  return n
}

export function bool(value: unknown, field: string, fallback?: boolean): boolean {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'boolean') throw new ValidationError(`${field} must be true or false`)
  return value
}

export function oneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) {
    return fallback
  }
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

export function email(value: unknown, field = 'email'): string {
  const v = str(value, field, { max: 254 }).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ValidationError(`${field} is not valid`)
  return v
}

export function strList(value: unknown, field: string, maxItems = 50, maxLen = 100): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be a list`)
  if (value.length > maxItems) throw new ValidationError(`${field} has too many items`)
  return value
    .map((v, i) => str(v, `${field}[${i}]`, { max: maxLen, optional: true }))
    .filter(Boolean)
}
