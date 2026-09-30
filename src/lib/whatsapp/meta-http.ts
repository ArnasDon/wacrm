// Pooled HTTP client for high-volume Graph API sends (campaigns).
//
// The default global fetch opens a keep-alive connection per request as
// needed, but at hundreds of messages per second the TLS handshakes and
// socket churn dominate. This agent keeps connections warm, negotiates
// HTTP/2 (many requests multiplexed per connection) and bounds how many
// sockets one process opens to graph.facebook.com.

import { Agent, fetch as undiciFetch } from 'undici';

const g = globalThis as unknown as { __wacrmMetaAgent?: Agent };

function agent(): Agent {
  g.__wacrmMetaAgent ??= new Agent({
    allowH2: true,
    // Enough for a 1 000 msg/s number at ~1.5 s latency even when HTTP/2
    // isn't negotiated (one request per socket). With HTTP/2 far fewer
    // sockets are opened — this is a ceiling, not a pool size.
    connections: 2048,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 10 * 60_000,
    connectTimeout: 10_000,
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
  });
  return g.__wacrmMetaAgent;
}

/** fetch() bound to the pooled agent — pass as `fetchImpl` to sends. */
export const metaFetch: typeof fetch = ((
  input: string | URL,
  init?: RequestInit
) =>
  undiciFetch(
    input as string,
    {
      ...(init as Record<string, unknown>),
      dispatcher: agent(),
    } as Parameters<typeof undiciFetch>[1]
  )) as unknown as typeof fetch;
