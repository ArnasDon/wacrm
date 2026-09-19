import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PaymentProvider } from '@/lib/db/types'

// ============================================================
// Paystack + Flutterwave HTTP adapters. Fixed, well-known hosts
// (no user-supplied URLs), 20s timeouts.
//
// Amount conventions differ and are the classic bug source:
//   Paystack    → integer kobo (minor units), same as our storage
//   Flutterwave → decimal naira (major units)
// Everything outside this file speaks minor units.
// ============================================================

export class PaymentProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentProviderError'
  }
}

export interface InitInput {
  secretKey: string
  reference: string
  amountMinor: number
  currency: string
  email: string
  phone: string | null
  name: string | null
  callbackUrl: string
  title: string
  description: string
  logoUrl: string | null
}

export interface VerifiedTransaction {
  success: boolean
  reference: string
  amountMinor: number
  currency: string
  channel: string | null
  providerTransactionId: string | null
}

async function call(url: string, init: RequestInit): Promise<{ status: number; json: Record<string, unknown> }> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, json }
  } catch {
    throw new PaymentProviderError('Payment provider is unreachable')
  } finally {
    clearTimeout(t)
  }
}

// ------------------------------------------------------------
// Paystack
// ------------------------------------------------------------

async function paystackInit(i: InitInput): Promise<string> {
  const { status, json } = await call('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { authorization: `Bearer ${i.secretKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: i.email,
      amount: i.amountMinor,
      currency: i.currency,
      reference: i.reference,
      callback_url: i.callbackUrl,
      metadata: { custom_fields: [{ display_name: 'Order', variable_name: 'order', value: i.description }] },
    }),
  })
  const data = json.data as { authorization_url?: string } | undefined
  if (status === 401) throw new PaymentProviderError('Paystack rejected the secret key')
  if (status >= 300 || !data?.authorization_url) {
    throw new PaymentProviderError(String(json.message ?? 'Paystack could not create the payment link'))
  }
  return data.authorization_url
}

async function paystackVerify(secretKey: string, reference: string): Promise<VerifiedTransaction> {
  const { status, json } = await call(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { authorization: `Bearer ${secretKey}` } },
  )
  if (status >= 300) throw new PaymentProviderError('Paystack verification failed')
  const d = json.data as {
    status?: string
    amount?: number
    currency?: string
    channel?: string
    id?: number
    reference?: string
  }
  return {
    success: d?.status === 'success',
    reference: d?.reference ?? reference,
    amountMinor: Number(d?.amount ?? 0),
    currency: String(d?.currency ?? ''),
    channel: d?.channel ?? null,
    providerTransactionId: d?.id != null ? String(d.id) : null,
  }
}

/** x-paystack-signature = HMAC-SHA512(raw body, secret key). */
export function verifyPaystackSignature(rawBody: string, header: string | null, secretKey: string): boolean {
  if (!header) return false
  const expected = createHmac('sha512', secretKey).update(rawBody).digest('hex')
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ------------------------------------------------------------
// Flutterwave (v3)
// ------------------------------------------------------------

async function flutterwaveInit(i: InitInput): Promise<string> {
  const { status, json } = await call('https://api.flutterwave.com/v3/payments', {
    method: 'POST',
    headers: { authorization: `Bearer ${i.secretKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      tx_ref: i.reference,
      amount: i.amountMinor / 100,
      currency: i.currency,
      redirect_url: i.callbackUrl,
      customer: { email: i.email, phonenumber: i.phone ?? undefined, name: i.name ?? undefined },
      customizations: { title: i.title, description: i.description, ...(i.logoUrl ? { logo: i.logoUrl } : {}) },
    }),
  })
  const data = json.data as { link?: string } | undefined
  if (status === 401) throw new PaymentProviderError('Flutterwave rejected the secret key')
  if (status >= 300 || !data?.link) {
    throw new PaymentProviderError(String(json.message ?? 'Flutterwave could not create the payment link'))
  }
  return data.link
}

async function flutterwaveVerify(secretKey: string, reference: string): Promise<VerifiedTransaction> {
  const { status, json } = await call(
    `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    { headers: { authorization: `Bearer ${secretKey}` } },
  )
  if (status >= 300) throw new PaymentProviderError('Flutterwave verification failed')
  const d = json.data as {
    status?: string
    amount?: number
    currency?: string
    payment_type?: string
    id?: number
    tx_ref?: string
  }
  return {
    success: d?.status === 'successful',
    reference: d?.tx_ref ?? reference,
    amountMinor: Math.round(Number(d?.amount ?? 0) * 100),
    currency: String(d?.currency ?? ''),
    channel: d?.payment_type ?? null,
    providerTransactionId: d?.id != null ? String(d.id) : null,
  }
}

/** Flutterwave sends the configured "secret hash" verbatim in verif-hash. */
export function verifyFlutterwaveHash(header: string | null, secretHash: string): boolean {
  if (!header || !secretHash) return false
  const a = Buffer.from(header)
  const b = Buffer.from(secretHash)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ------------------------------------------------------------

export function initializePayment(provider: PaymentProvider, input: InitInput): Promise<string> {
  return provider === 'paystack' ? paystackInit(input) : flutterwaveInit(input)
}

export function verifyTransaction(
  provider: PaymentProvider,
  secretKey: string,
  reference: string,
): Promise<VerifiedTransaction> {
  return provider === 'paystack' ? paystackVerify(secretKey, reference) : flutterwaveVerify(secretKey, reference)
}

/** Cheap credential check for the settings "Test" button. */
export async function testCredentials(provider: PaymentProvider, secretKey: string): Promise<boolean> {
  const url =
    provider === 'paystack'
      ? 'https://api.paystack.co/transaction?perPage=1'
      : 'https://api.flutterwave.com/v3/transactions?page=1'
  const { status } = await call(url, { headers: { authorization: `Bearer ${secretKey}` } })
  return status === 200
}
