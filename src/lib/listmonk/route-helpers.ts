import { NextResponse } from 'next/server';
import { ListmonkError } from './client';
import { ListmonkNotConfiguredError } from './config';

/**
 * Map an error from the listmonk layer onto an HTTP response,
 * preserving the upstream status so a 404 stays a 404 and a
 * credential failure doesn't masquerade as a wacrm bug.
 *
 * Mirrors `toErrorResponse` in @/lib/auth/account — same shape, same
 * calling convention, different error family.
 */
export function toListmonkErrorResponse(err: unknown): NextResponse {
  if (err instanceof ListmonkNotConfiguredError) {
    return NextResponse.json(
      { error: err.message, code: 'listmonk_not_configured' },
      { status: 503 }
    );
  }

  if (err instanceof ListmonkError) {
    // Upstream 5xx becomes 502 here: the caller's request was fine,
    // our dependency failed.
    const status = err.status >= 500 ? 502 : err.status;
    return NextResponse.json(
      { error: err.message, code: 'listmonk_error' },
      { status }
    );
  }

  console.error('[email] unexpected error:', err);
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}

/** Parse and validate a numeric route param. */
export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
