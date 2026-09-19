import { NextResponse } from 'next/server'
import { InvalidIdError } from '@/lib/db/ids'

// ============================================================
// Typed HTTP errors. Route handlers throw these and end with a
// single `catch (err) { return toErrorResponse(err) }`. Unknown
// errors collapse to a generic 500 — internals never reach the
// wire.
// ============================================================

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(401, message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(403, message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found') {
    super(404, message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(400, message, details)
    this.name = 'ValidationError'
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, message)
    this.name = 'ConflictError'
  }
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(
      err.details ? { error: err.message, details: err.details } : { error: err.message },
      { status: err.status },
    )
  }
  if (err instanceof InvalidIdError) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
  // Mongo duplicate key → 409 without leaking the index name.
  if (err && typeof err === 'object' && (err as { code?: number }).code === 11000) {
    return NextResponse.json({ error: 'Already exists' }, { status: 409 })
  }
  console.error('[api] unhandled error:', err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/** Parse a JSON body; a malformed body is a 400, not a 500. */
export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('Expected a JSON object')
    }
    return body as T
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new ValidationError('Invalid JSON body')
  }
}
