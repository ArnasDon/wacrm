import { after, NextResponse } from 'next/server'
import { isId } from '@/lib/db/ids'
import { systemContext } from '@/lib/db/scoped'
import { accountExists } from '@/lib/db/unscoped'
import type { PaymentProvider } from '@/lib/db/types'
import { verifyFlutterwaveHash, verifyPaystackSignature } from '@/lib/payments/providers'
import { decrypt } from '@/lib/security/secrets'
import { getPaymentConfig, settleFromProvider } from '@/lib/sales/orders'

// ============================================================
// Per-merchant payment webhook:
//   POST /api/payments/paystack/<accountId>/webhook
//   POST /api/payments/flutterwave/<accountId>/webhook
//
// Each merchant has their OWN gateway keys, so the tenant must be
// known before the signature can be checked — it comes from the URL
// path, and the signature is then verified with THAT account's
// secret. A request with a forged accountId fails verification.
//
// The payload is used only to learn the reference; the transaction
// is re-verified against the provider API (amount + currency checked
// against our own order) before anything is marked paid.
// ============================================================

type Params = { params: Promise<{ provider: string; accountId: string }> }

export async function POST(request: Request, { params }: Params) {
  const { provider: rawProvider, accountId } = await params
  if ((rawProvider !== 'paystack' && rawProvider !== 'flutterwave') || !isId(accountId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const provider = rawProvider as PaymentProvider
  const raw = await request.text()
  if (raw.length > 512 * 1024) return NextResponse.json({ error: 'Too large' }, { status: 413 })
  if (!(await accountExists(accountId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ctx = systemContext(accountId, `${provider}-webhook`)
  const cfg = await getPaymentConfig(ctx, provider)
  if (!cfg) return NextResponse.json({ error: 'Not configured' }, { status: 404 })

  const valid =
    provider === 'paystack'
      ? verifyPaystackSignature(raw, request.headers.get('x-paystack-signature'), decrypt(cfg.secretKeyEnc))
      : !!cfg.webhookHashEnc && verifyFlutterwaveHash(request.headers.get('verif-hash'), decrypt(cfg.webhookHashEnc))
  if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })

  let event: { event?: string; data?: { reference?: string; tx_ref?: string; status?: string } }
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const isSuccessEvent =
    provider === 'paystack' ? event.event === 'charge.success' : event.event === 'charge.completed'
  const reference = provider === 'paystack' ? event.data?.reference : event.data?.tx_ref
  if (isSuccessEvent && typeof reference === 'string' && reference.length <= 100) {
    after(() =>
      settleFromProvider(ctx, provider, reference).catch((err) => console.error('[payments] settle failed', err)),
    )
  }
  // Always 200 once authenticated so the gateway stops retrying.
  return NextResponse.json({ received: true })
}
