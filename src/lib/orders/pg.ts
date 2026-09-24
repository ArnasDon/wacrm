/**
 * Connection helper to the production biodata orders Postgres database
 * — used by the flow's mobile-lookup node and the inbox's order-search
 * dialog.
 *
 * On Cloudflare Workers this goes through the `ORDERS_HYPERDRIVE`
 * binding rather than a plain TCP connection to `ORDERS_PG_*`. A direct
 * connect from a Worker to this (non-Hyperdrive) origin fails outright
 * — "proxy request failed, cannot connect to the specified address",
 * confirmed via `wrangler tail` — Workers only permit raw outbound TCP
 * to a Postgres origin through Hyperdrive's proxy. Outside Workers
 * (local `next dev`, tests) `cloudflare:workers` doesn't resolve, so
 * this falls back to a plain connection built from `ORDERS_PG_*`.
 *
 * Also deliberately does NOT reuse a module-level `Pool` across
 * requests: a Workers isolate can be frozen/evicted between
 * invocations, so a pooled connection from one request can be dead by
 * the time a later request reuses it ("Connection terminated
 * unexpectedly", also confirmed via tail). A short-lived `Client` per
 * call, always closed, sidesteps that.
 */

import { Client, type ClientConfig } from "pg";

async function clientConfig(): Promise<ClientConfig> {
  try {
    const { env } = (await import(
      /* @vite-ignore */ "cloudflare:workers"
    )) as { env: { ORDERS_HYPERDRIVE?: { connectionString: string } } };
    if (env.ORDERS_HYPERDRIVE) {
      return {
        connectionString: env.ORDERS_HYPERDRIVE.connectionString,
        connectionTimeoutMillis: 5000,
      };
    }
  } catch {
    // Not running under the Workers runtime — fall through to plain env vars.
  }

  return {
    host: process.env.ORDERS_PG_HOST,
    port: process.env.ORDERS_PG_PORT
      ? Number(process.env.ORDERS_PG_PORT)
      : 5432,
    database: process.env.ORDERS_PG_DBNAME,
    user: process.env.ORDERS_PG_USER,
    password: process.env.ORDERS_PG_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
  };
}

/**
 * Opens a fresh connection, runs `fn`, and always closes the
 * connection afterward — including on error, so a failed query can't
 * leak a socket.
 */
export async function withOrdersClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(await clientConfig());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}
