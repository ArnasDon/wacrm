import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { getConnectionEntry } from './connection'

/** Thrown by the send helpers below; the cron tick maps it onto `envio_leads.erro`. */
export class BaileysSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BaileysSendError'
  }
}

/**
 * Resolves the real canonical JID on WhatsApp for a phone number.
 * For Brazilian numbers (+55), WhatsApp accounts may be registered with
 * or without the 9th digit (legacy 8-digit vs modern 9-digit format).
 * Querying sock.onWhatsApp() with both variants ensures the message is
 * sent to the exact JID registered on WhatsApp servers, avoiding silent drops.
 */
export async function resolveRecipientJid(sock: any, rawPhone: string): Promise<string> {
  const clean = sanitizePhoneForMeta(rawPhone)
  if (!clean) {
    throw new BaileysSendError('Número de telefone inválido')
  }

  // Brazilian mobile numbers (+55)
  if (clean.startsWith('55') && clean.length >= 12) {
    const ddd = clean.slice(2, 4)
    const rest = clean.slice(4)
    const variants: string[] = []

    if (rest.length === 9) {
      // Modern 9 digits first, legacy 8 digits fallback
      variants.push(clean)
      if (rest.startsWith('9')) {
        variants.push(`55${ddd}${rest.slice(1)}`)
      }
    } else if (rest.length === 8) {
      // Modern 9 digits first, legacy 8 digits fallback
      variants.push(`55${ddd}9${rest}`)
      variants.push(clean)
    } else {
      variants.push(clean)
    }

    try {
      if (typeof sock.onWhatsApp === 'function') {
        const results = await sock.onWhatsApp(...variants)
        if (Array.isArray(results) && results.length > 0) {
          const valid = results.find((r: any) => r && r.exists && r.jid)
          if (valid) {
            return valid.jid
          }
          // If WhatsApp explicitly answered and none exists
          const allExplicitlyFalse = results.every((r: any) => r && r.exists === false)
          if (allExplicitlyFalse) {
            throw new BaileysSendError('Número não possui conta no WhatsApp')
          }
        }
      }
    } catch (err) {
      if (err instanceof BaileysSendError) throw err
      console.warn('[baileys/send] onWhatsApp query warning:', err)
    }

    // Default to the sanitized number
    return `${clean}@s.whatsapp.net`
  }

  // Non-Brazilian international numbers
  try {
    if (typeof sock.onWhatsApp === 'function') {
      const results = await sock.onWhatsApp(clean)
      if (Array.isArray(results) && results.length > 0) {
        const valid = results.find((r: any) => r && r.exists && r.jid)
        if (valid) {
          return valid.jid
        }
        if (results.every((r: any) => r && r.exists === false)) {
          throw new BaileysSendError('Número não possui conta no WhatsApp')
        }
      }
    }
  } catch (err) {
    if (err instanceof BaileysSendError) throw err
    console.warn('[baileys/send] onWhatsApp query warning:', err)
  }

  return `${clean}@s.whatsapp.net`
}

function requireSocket(accountId: string) {
  const entry = getConnectionEntry(accountId)
  if (!entry?.sock) {
    throw new BaileysSendError('Sessão do WhatsApp não está conectada')
  }
  return entry.sock
}

export async function sendText(accountId: string, phone: string, text: string): Promise<void> {
  const sock = requireSocket(accountId)
  const jid = await resolveRecipientJid(sock, phone)

  // Anti-ban / sync heuristic: human typing presence
  try {
    if (typeof sock.sendPresenceUpdate === 'function') {
      await sock.sendPresenceUpdate('composing', jid)
      await new Promise((resolve) => setTimeout(resolve, 1500 + Math.floor(Math.random() * 800)))
    }
  } catch {
    // Ignore presence errors, do not block send
  }

  try {
    const result = await sock.sendMessage(jid, { text })
    console.log(`[baileys/send] Mensagem enviada para ${jid} (original: ${phone}), id: ${result?.key?.id}`)
  } catch (err) {
    throw new BaileysSendError(err instanceof Error ? err.message : 'Falha ao enviar mensagem')
  } finally {
    try {
      if (typeof sock.sendPresenceUpdate === 'function') {
        await sock.sendPresenceUpdate('paused', jid)
      }
    } catch {
      // Ignore
    }
  }
}

/**
 * Image + caption. Baileys fetches `imageUrl` itself — no need to
 * download the file into this process first (spec section 3).
 */
export async function sendImageWithCaption(
  accountId: string,
  phone: string,
  imageUrl: string,
  caption: string,
): Promise<void> {
  const sock = requireSocket(accountId)
  const jid = await resolveRecipientJid(sock, phone)

  try {
    if (typeof sock.sendPresenceUpdate === 'function') {
      await sock.sendPresenceUpdate('composing', jid)
      await new Promise((resolve) => setTimeout(resolve, 1500 + Math.floor(Math.random() * 800)))
    }
  } catch {
    // Ignore
  }

  try {
    const result = await sock.sendMessage(jid, { image: { url: imageUrl }, caption })
    console.log(`[baileys/send] Imagem enviada para ${jid} (original: ${phone}), id: ${result?.key?.id}`)
  } catch (err) {
    throw new BaileysSendError(err instanceof Error ? err.message : 'Falha ao enviar imagem')
  } finally {
    try {
      if (typeof sock.sendPresenceUpdate === 'function') {
        await sock.sendPresenceUpdate('paused', jid)
      }
    } catch {
      // Ignore
    }
  }
}
