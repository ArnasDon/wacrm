/**
 * Throwaway Worker that runs the seed + verification against a real D1
 * binding. Used only by `npm run db:seed`; it is not part of the app
 * and is never deployed.
 *
 * A Worker is needed because a D1 binding only exists inside the
 * Workers runtime — there is no way to open one from plain Node.
 */
import { seed, verify } from './seed-d1'

export default {
  async fetch(_request: Request, env: { DB: D1Database }): Promise<Response> {
    try {
      const ids = await seed(env.DB)
      const results = await verify(env.DB, ids)

      const failed = results.filter((r) => !r.ok)
      const lines = results.map(
        (r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.check}${r.detail ? ` — ${r.detail}` : ''}`,
      )

      lines.push(
        '',
        failed.length === 0
          ? `All ${results.length} checks passed.`
          : `${failed.length} of ${results.length} checks FAILED.`,
      )

      return new Response(lines.join('\n'), {
        status: failed.length === 0 ? 200 : 500,
        headers: { 'content-type': 'text/plain' },
      })
    } catch (error) {
      return new Response(
        `Seed threw before verification could run:\n${
          error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
        }`,
        { status: 500, headers: { 'content-type': 'text/plain' } },
      )
    }
  },
}
