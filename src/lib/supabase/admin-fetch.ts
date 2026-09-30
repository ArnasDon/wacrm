// fetch for the server-side (service-role) Supabase clients: every
// request gets a time limit. Without one, a request on a half-open
// connection (network blip, laptop sleep, restart) can wait forever —
// and one stuck webhook then blocks every webhook queued behind it on
// its Kafka partition. 60 s is far above any normal query here; the
// caller's own abort signal still works.

const TIMEOUT_MS = 60_000;

export const adminFetch: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  return fetch(input, { ...init, signal });
};
