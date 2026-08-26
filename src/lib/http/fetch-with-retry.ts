import { readResponseJson } from './response-json';

export interface PostJsonWithRetryOptions {
  /** Extra attempts beyond the first. Default 2 (3 attempts total). */
  retries?: number;
  /** Delay before the first retry, in ms; doubles each subsequent attempt. Default 800. */
  baseDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST JSON to `url`, retrying when the failure looks like an infra
 * blip rather than a real application error.
 *
 * A route that reaches our own error handling always answers with a
 * JSON `{ error }` body (see e.g. `/api/whatsapp/send`'s
 * `SendMessageError` mapping) — whatever the HTTP status. A response
 * with NO parseable JSON body (a reverse proxy's bare error page, or
 * nothing at all) means the request never reached that handling: the
 * app was slow, mid-deploy, or restarting. Same story for `fetch`
 * itself throwing. Both are worth a short retry; a real, JSON-shaped
 * application error is returned immediately on the first attempt.
 */
// Mirrors readResponseJson's `any` default (response-json.ts) so this
// stays a drop-in replacement for the raw fetch + readResponseJson pair.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function postJsonWithRetry<T = any>(
  url: string,
  body: unknown,
  { retries = 2, baseDelayMs = 800 }: PostJsonWithRetryOptions = {}
): Promise<{ res: Response; payload: T | Record<string, never> }> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt >= retries) throw err;
      await delay(baseDelayMs * 2 ** attempt);
      continue;
    }

    try {
      const payload = await readResponseJson<T>(res);
      return { res, payload };
    } catch {
      if (attempt >= retries) return { res, payload: {} };
      await delay(baseDelayMs * 2 ** attempt);
    }
  }
}
