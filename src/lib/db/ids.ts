import { ObjectId } from 'mongodb'

// ============================================================
// Id policy: every document `_id` (and every reference to one,
// including `accountId`) is a 24-char lowercase hex STRING.
//
// One representation everywhere means no ObjectId-vs-string
// mismatches that silently match nothing, and ids serialise to
// JSON without conversion. `parseId` is the single gate for
// ids arriving from the outside world — it also blocks operator
// injection (`{ "$ne": null }` is not a string, so it's refused).
// ============================================================

const ID_RE = /^[a-f0-9]{24}$/

export function newId(): string {
  return new ObjectId().toHexString()
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value)
}

export class InvalidIdError extends Error {
  readonly status = 400 as const
  constructor(field = 'id') {
    super(`Invalid ${field}`)
    this.name = 'InvalidIdError'
  }
}

/** Validate an untrusted id. Throws `InvalidIdError` (→ 400). */
export function parseId(value: unknown, field = 'id'): string {
  if (!isId(value)) throw new InvalidIdError(field)
  return value
}
