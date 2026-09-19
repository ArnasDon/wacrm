// Client-side JSON fetch helper. Throws an Error carrying the
// server's `error` message so callers can toast it directly.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T = unknown>(
  url: string,
  opts: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'), cache: 'no-store' }
  if (opts.form) init.body = opts.form
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body)
    init.headers = { 'content-type': 'application/json' }
  }
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', 0)
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/login'
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status)
  }
  return data
}
