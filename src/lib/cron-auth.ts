import { timingSafeEqual } from 'node:crypto'

/**
 * Shared secret for GET /api/automations/cron and GET /api/flows/cron.
 *
 * Accepts either:
 *   - `x-cron-secret` (external pingers, curl, GitHub Actions)
 *   - `Authorization: Bearer …` (Vercel Cron Jobs — set `CRON_SECRET` in
 *     the project to the same value as `AUTOMATION_CRON_SECRET`)
 */
export function verifyCronSecret(request: Request, expected: string): boolean {
  const supplied = readSuppliedCronSecret(request)
  if (!supplied) return false
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (suppliedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(suppliedBuf, expectedBuf)
}

function readSuppliedCronSecret(request: Request): string {
  const direct = request.headers.get('x-cron-secret')
  if (direct) return direct
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim()
  return ''
}
