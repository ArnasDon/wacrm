import { NextResponse } from 'next/server'
import { isId } from '@/lib/db/ids'
import { systemContext } from '@/lib/db/scoped'
import { accountExists } from '@/lib/db/unscoped'
import type { PaymentProvider } from '@/lib/db/types'
import { getAppBaseUrl } from '@/lib/http/base-url'
import { settleFromProvider } from '@/lib/sales/orders'

/**
 * GET — where Paystack / Flutterwave send the CUSTOMER after paying.
 * The query string is attacker-controllable, so it's only used to
 * learn the reference; settlement re-verifies with the provider API.
 * This path also makes payments confirm on local installs where the
 * gateway can't reach the webhook URL.
 */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string; accountId: string }> }) {
  const base = getAppBaseUrl(request)
  const { provider: rawProvider, accountId } = await params
  const url = new URL(request.url)
  const reference = url.searchParams.get('reference') ?? url.searchParams.get('tx_ref') ?? url.searchParams.get('trxref')
  const done = (status: string) => NextResponse.redirect(`${base}/pay/complete?status=${status}`, 303)

  if ((rawProvider !== 'paystack' && rawProvider !== 'flutterwave') || !isId(accountId) || !reference || reference.length > 100) {
    return done('invalid')
  }
  if (!(await accountExists(accountId))) return done('invalid')
  try {
    const { outcome } = await settleFromProvider(
      systemContext(accountId, `${rawProvider}-return`),
      rawProvider as PaymentProvider,
      reference,
      request,
    )
    return done(outcome === 'paid' || outcome === 'already_paid' ? 'paid' : outcome === 'not_successful' ? 'failed' : 'pending')
  } catch (err) {
    console.error('[payments] return settle failed', err)
    return done('pending')
  }
}
