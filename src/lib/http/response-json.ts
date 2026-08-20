/**
 * Parses an HTTP response as JSON without leaking the browser's cryptic
 * `Unexpected token '<'` error when a proxy, login redirect, or error page
 * returns HTML instead.
 *
 * This deliberately does not reject non-2xx responses: callers often need
 * the JSON error payload before deciding how to present the failure.
 */
// Response.json() returns `any`; retaining that default keeps this helper a
// drop-in migration path. Callers with known contracts should pass `T`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readResponseJson<T = any>(
  response: Response
): Promise<T> {
  const raw = await response.text();
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!raw.trim()) {
    throw new Error(
      `The server returned an empty response (${response.status}).`
    );
  }

  if (!contentType.includes('json')) {
    throw new Error(
      `The server returned ${contentType || 'an unknown content type'} instead of JSON (${response.status}).`
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`The server returned invalid JSON (${response.status}).`);
  }
}
