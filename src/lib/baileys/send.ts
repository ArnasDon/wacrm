import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { getConnectionEntry } from './connection'

/** Thrown by the send helpers below; the cron tick maps it onto `envio_leads.erro`. */
export class BaileysSendError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BaileysSendError'
  }
}

function toJid(phone: string): string {
  return `${sanitizePhoneForMeta(phone)}@s.whatsapp.net`
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
  try {
    await sock.sendMessage(toJid(phone), { text })
  } catch (err) {
    throw new BaileysSendError(err instanceof Error ? err.message : 'Falha ao enviar mensagem')
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
  try {
    await sock.sendMessage(toJid(phone), { image: { url: imageUrl }, caption })
  } catch (err) {
    throw new BaileysSendError(err instanceof Error ? err.message : 'Falha ao enviar imagem')
  }
}
