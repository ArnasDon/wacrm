import { sanitizePhone } from './phone-utils'

export function phoneToChatId(phone: string): string {
  const digits = sanitizePhone(phone)
  return `${digits}@c.us`
}

export function chatIdToPhone(chatId: string): string {
  return chatId.replace(/@(c\.us|s\.whatsapp\.net|lid)$/, '')
}

export function isGroupChatId(chatId: string): boolean {
  return chatId.endsWith('@g.us')
}

export function isNewsletterChatId(chatId: string): boolean {
  return chatId.endsWith('@newsletter')
}
