import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
} from 'baileys'
import QRCode from 'qrcode'

import { getSupabaseAuthState } from './auth-state'
import { supabaseAdmin } from './admin-client'

/**
 * Baileys socket lifecycle — one connection per account, kept as a
 * module-scope singleton so the same process can serve HTTP requests
 * (pairing/status routes, the send call from the cron tick) and hold
 * the WhatsApp WebSocket open between them. See the plan's "risco
 * arquitetural" note: if the Hostinger process turns out to not be
 * long-lived, `getOrCreateConnection` still works correctly per-call —
 * it just reconnects (cheap, no QR needed) more often than ideal.
 *
 * v1 is deliberately simple on resilience (user's explicit choice): on
 * any `close` that isn't a real logout, we just mark the session
 * `desconectado` and drop the socket — no reconnect loop, no backoff
 * supervisor. Whoever needs to send next (a cron tick, or the pairing
 * screen) calls `getOrCreateConnection` again, which reconnects from
 * the saved creds without a new QR (that's normal Baileys behaviour —
 * only `DisconnectReason.loggedOut` invalidates the saved session).
 */

interface ConnectionEntry {
  sock: WASocket | null
  /** Data-URL of the current pairing QR, or null when not pairing. */
  qrDataUrl: string | null
}

const connections = new Map<string, ConnectionEntry>()

async function setStatusConexao(
  accountId: string,
  status: 'desconectado' | 'pareando' | 'conectado',
  identificador = 'principal',
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('baileys_sessao')
    .update({ status_conexao: status, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('identificador', identificador)
  if (error) {
    console.error('[baileys/connection] failed to update status_conexao:', error.message)
  }
}

/** Wipes the saved session after a real logout — the old creds can never reconnect. */
async function resetSessao(accountId: string, identificador = 'principal'): Promise<void> {
  // `baileys_sessao_keys` cascades on `baileys_sessao.id` (migration
  // 078) — deleting the parent row is enough, and the next
  // getSupabaseAuthState() call recreates it with fresh initAuthCreds().
  const { error } = await supabaseAdmin()
    .from('baileys_sessao')
    .delete()
    .eq('account_id', accountId)
    .eq('identificador', identificador)
  if (error) {
    console.error('[baileys/connection] failed to reset session after logout:', error.message)
  }
}

/**
 * Returns the live connection entry for an account, creating a socket
 * (reusing saved creds, or starting a fresh pairing) if none exists
 * yet in this process. Safe to call repeatedly — a call while a socket
 * is already up/connecting is a no-op.
 */
export async function getOrCreateConnection(accountId: string): Promise<ConnectionEntry> {
  const existing = connections.get(accountId)
  if (existing?.sock) return existing

  const entry: ConnectionEntry = { sock: null, qrDataUrl: null }
  connections.set(accountId, entry)

  const { state, saveCreds } = await getSupabaseAuthState(accountId)
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      // undefined logger arg = Baileys' own default (silent-ish pino child).
      keys: makeCacheableSignalKeyStore(state.keys, undefined),
    },
    version,
  })
  entry.sock = sock

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update

    if (qr) {
      entry.qrDataUrl = await QRCode.toDataURL(qr)
      await setStatusConexao(accountId, 'pareando')
    }

    if (connection === 'open') {
      entry.qrDataUrl = null
      await setStatusConexao(accountId, 'conectado')
    }

    if (connection === 'close') {
      // Duck-typed Boom-shaped error (Baileys depends on @hapi/boom
      // internally but doesn't re-export its type) — statusCode maps
      // 1:1 onto DisconnectReason.
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode
      connections.delete(accountId)
      await setStatusConexao(accountId, 'desconectado')
      if (statusCode === DisconnectReason.loggedOut) {
        await resetSessao(accountId)
      }
      // Anything else (network blip, restart, etc.): deliberately no
      // auto-reconnect here — see module doc comment above.
    }
  })

  return entry
}

/** Read-only accessor for the pairing/status routes — never opens a socket. */
export function getConnectionEntry(accountId: string): ConnectionEntry | undefined {
  return connections.get(accountId)
}

/** Whether this process currently holds a live, authenticated socket for the account. */
export function isConnected(accountId: string): boolean {
  return Boolean(connections.get(accountId)?.sock)
}
