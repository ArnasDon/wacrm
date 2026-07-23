import crypto from 'crypto'

/**
 * WhatsApp token encryption.
 *
 * Format - GCM (current):
 *   `<iv-hex>:<ciphertext-hex>:<authTag-hex>`      (three parts)
 *
 * Format - CBC (legacy, decrypt-only):
 *   `<iv-hex>:<ciphertext-hex>`                    (two parts)
 *
 * Why GCM instead of CBC:
 *   CBC without a MAC is unauthenticated - an attacker who can write
 *   rows to `whatsapp_config` can flip bits in the ciphertext without
 *   the decrypt throwing. GCM appends an authentication tag so any
 *   tampering fails decryption hard.
 *
 * Backward compatibility:
 *   `decrypt()` auto-detects the format by counting parts, so legacy
 *   rows keep working. New `encrypt()` output is always GCM.
 */

// 12 bytes is the NIST-recommended IV length for GCM and matches the
// default Web Crypto behavior, so a future port stays straightforward.
const GCM_IV_LENGTH = 12
const CBC_IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

export class EncryptionConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EncryptionConfigError'
  }
}

function getEncryptionKeyBuffer(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim()
  if (!raw) {
    throw new EncryptionConfigError('ENCRYPTION_KEY is not configured.')
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new EncryptionConfigError('ENCRYPTION_KEY must be 64 hex characters.')
  }
  return Buffer.from(raw, 'hex')
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(GCM_IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKeyBuffer(), iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
}

export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':')

  if (parts.length === 3) {
    const [ivHex, ctHex, tagHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    if (iv.length !== GCM_IV_LENGTH) {
      throw new Error(`Encrypted token has unexpected GCM IV length ${iv.length}`)
    }

    const authTag = Buffer.from(tagHex, 'hex')
    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(`Encrypted token has unexpected GCM auth-tag length ${authTag.length}`)
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKeyBuffer(), iv)
    decipher.setAuthTag(authTag)
    let decrypted = decipher.update(ctHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }

  if (parts.length === 2) {
    const [ivHex, ctHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    if (iv.length !== CBC_IV_LENGTH) {
      throw new Error(`Encrypted token has unexpected CBC IV length ${iv.length}`)
    }

    const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKeyBuffer(), iv)
    let decrypted = decipher.update(ctHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }

  throw new Error(
    `Encrypted token has unrecognised format (expected 1 or 2 colons, got ${parts.length - 1})`,
  )
}

/**
 * Cheap format detector - call sites use this to decide whether to
 * write a refreshed GCM ciphertext back to the database after a
 * successful legacy decrypt. Does not attempt decryption; purely a
 * structural check.
 */
export function isLegacyFormat(encryptedText: string): boolean {
  return encryptedText.split(':').length === 2
}
