import 'server-only'

// Secrets at rest (API keys, OAuth refresh tokens, payment keys,
// SMTP passwords) reuse the AES-256-GCM helper built for WhatsApp
// tokens. Plaintext never leaves the server: API responses expose
// only `maskSecret()` output.
export { encrypt, decrypt } from '@/lib/whatsapp/encryption'

export function maskSecret(plain: string | null | undefined): string | null {
  if (!plain) return null
  if (plain.length <= 8) return '••••'
  return `${plain.slice(0, 4)}••••${plain.slice(-4)}`
}
