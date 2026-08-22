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
 *
 * One deliberate exception to "no auto-reconnect": `DisconnectReason
 * .restartRequired` (515, "Stream Errored (restart required)"). This
 * isn't a dropped session — it's WhatsApp's own mandatory last step of
 * the device-pairing handshake: after accepting a new linked device it
 * always closes with 515 expecting an immediate reconnect using the
 * now-saved creds to finish registration. Confirmed 2026-08-21 (real
 * pairing attempt, first-ever link on a fresh number, raw
 * lastDisconnect logged): without this, pairing never completes on
 * ANY attempt — the phone times out on "não foi possível conectar"
 * because the finishing reconnect never happens. Every other
 * disconnect reason (network blip, timeout, etc.) still requires a
 * manual re-pair, per the original decision.
 */

interface ConnectionEntry {
  sock: WASocket | null
  /** Data-URL of the current pairing QR, or null when not pairing. */
  qrDataUrl: string | null
  /**
   * Real handshake state — `sock` is assigned as soon as `makeWASocket()`
   * runs, well before the `connection.update` 'open' event fires, so
   * `sock` alone can't tell a caller whether the socket is actually ready
   * to send. `isConnected()` must check this instead of `sock` presence.
   */
  status: 'connecting' | 'open' | 'closed'
}

const connections = new Map<string, ConnectionEntry>()

/**
 * Pulls every field worth knowing out of a Baileys disconnect error for
 * diagnostics. `lastDisconnect.error` is a duck-typed Boom error — the
 * interesting bits are `.output.statusCode`/`.output.payload` (the HTTP-
 * like code WhatsApp closed with) and `.data` (WhatsApp sometimes attaches
 * the raw stanza/reason here). Logged as plain fields (not JSON.stringify
 * on the Error itself, which drops message/stack silently).
 */
function describeDisconnectError(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return { raw: error }
  const err = error as {
    message?: string
    output?: { statusCode?: number; payload?: unknown }
    data?: unknown
    stack?: string
  }
  return {
    message: err.message,
    statusCode: err.output?.statusCode,
    payload: err.output?.payload,
    data: err.data,
  }
}

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

  const entry: ConnectionEntry = { sock: null, qrDataUrl: null, status: 'connecting' }
  connections.set(accountId, entry)

  const { state, saveCreds } = await getSupabaseAuthState(accountId)
  const { version, isLatest } = await fetchLatestBaileysVersion().catch((err) => {
    console.error('[baileys/connection] fetchLatestBaileysVersion failed, falling back to package default:', err)
    return { version: undefined, isLatest: undefined }
  })
  console.log('[baileys/connection] resolved WA protocol version:', JSON.stringify({ version, isLatest }))

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
      console.log('[baileys/connection] new QR issued for account', accountId)
    }

    if (connection === 'open') {
      entry.qrDataUrl = null
      entry.status = 'open'
      await setStatusConexao(accountId, 'conectado')
      console.log('[baileys/connection] connection OPEN for account', accountId)
    }

    if (connection === 'close') {
      entry.status = 'closed'
      // Duck-typed Boom-shaped error (Baileys depends on @hapi/boom
      // internally but doesn't re-export its type) — statusCode maps
      // 1:1 onto DisconnectReason.
      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode
      // Temporary diagnostic logging (2026-08-21, pairing-rejected
      // investigation) — full raw disconnect detail, not just the
      // status code, so a real WhatsApp-side rejection reason (if one
      // is present in .data/.payload) is visible instead of guessed at.
      console.error(
        '[baileys/connection] CLOSE for account',
        accountId,
        JSON.stringify(describeDisconnectError(lastDisconnect?.error)),
      )
      connections.delete(accountId)

      if (statusCode === DisconnectReason.restartRequired) {
        // Mandatory finishing step of the pairing handshake — see
        // module doc comment. Reconnects once, immediately, with the
        // creds `creds.update` already saved; no new QR is issued.
        console.log(
          '[baileys/connection] 515 restart required — reconnecting to finish pairing for account',
          accountId,
        )
        await getOrCreateConnection(accountId)
        return
      }

      await setStatusConexao(accountId, 'desconectado')
      if (statusCode === DisconnectReason.loggedOut) {
        await resetSessao(accountId)
      }
      // Anything else (network blip, timeout, etc.): deliberately no
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
  return connections.get(accountId)?.status === 'open'
}

/**
 * Distinguishes "still reconnecting" (no QR needed, socket exists but
 * hasn't finished the handshake yet) from "actually closed" — callers
 * like the envios cron need this to avoid pausing a lote on a socket
 * that's mid-reconnect and will be ready on the next tick.
 */
export function getConnectionStatus(
  accountId: string,
): 'connecting' | 'open' | 'closed' | undefined {
  return connections.get(accountId)?.status
}
