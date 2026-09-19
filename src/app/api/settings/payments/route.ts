import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection } from '@/lib/db/scoped'
import type { PaymentConfigDoc } from '@/lib/db/types'
import { getAppBaseUrl } from '@/lib/http/base-url'
import { readJson, ValidationError } from '@/lib/http/errors'
import { bool, oneOf, optStr } from '@/lib/http/validate'
import { testCredentials } from '@/lib/payments/providers'
import { decrypt, encrypt, maskSecret } from '@/lib/security/secrets'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/** GET — configured gateways (keys masked) + each one's webhook URL. Admin+. */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const configs = await scopedCollection<PaymentConfigDoc>(ctx, 'payment_configs')
    const rows = await configs.find({}).toArray()
    const base = getAppBaseUrl(request)
    return NextResponse.json({
      providers: (['paystack', 'flutterwave'] as const).map((p) => {
        const c = rows.find((r) => r.provider === p)
        return {
          provider: p,
          connected: !!c,
          enabled: c?.enabled ?? false,
          publicKey: c?.publicKey ?? null,
          secretKeyMasked: c ? maskSecret(decrypt(c.secretKeyEnc)) : null,
          hasWebhookHash: !!c?.webhookHashEnc,
          webhookUrl: `${base}/api/payments/${p}/${ctx.accountId}/webhook`,
        }
      }),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PUT { provider, secretKey?, publicKey?, webhookHash?, enabled? } — keys verified before saving. Admin+. */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`integration:${ctx.userId}`, RATE_LIMITS.integrationTest)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await readJson(request)
    const provider = oneOf(body.provider, 'provider', ['paystack', 'flutterwave'] as const)
    const configs = await scopedCollection<PaymentConfigDoc>(ctx, 'payment_configs')
    const existing = await configs.findOne({ provider })

    const secretKey = optStr(body.secretKey, 'secretKey', 200)
    if (!existing && !secretKey) throw new ValidationError('Secret key is required')
    const set: Partial<PaymentConfigDoc> = {}
    if (secretKey) {
      const prefix = provider === 'paystack' ? /^sk_(test|live)_/ : /^FLWSECK(_TEST)?-/
      if (!prefix.test(secretKey)) {
        throw new ValidationError(provider === 'paystack' ? 'Paystack secret keys start with sk_test_ or sk_live_' : 'Flutterwave secret keys start with FLWSECK')
      }
      if (!(await testCredentials(provider, secretKey))) throw new ValidationError(`${provider} rejected this secret key`)
      set.secretKeyEnc = encrypt(secretKey)
    }
    if ('publicKey' in body) set.publicKey = optStr(body.publicKey, 'publicKey', 200)
    if ('webhookHash' in body) {
      const h = optStr(body.webhookHash, 'webhookHash', 200)
      set.webhookHashEnc = h ? encrypt(h) : null
    }
    if ('enabled' in body) set.enabled = bool(body.enabled, 'enabled')
    else if (!existing) set.enabled = true

    // Defaults for a fresh row — only for fields this request didn't set
    // (a field can't appear in both $set and $setOnInsert).
    const onInsert: Record<string, unknown> = {}
    if (!existing) {
      if (!('publicKey' in set)) onInsert.publicKey = null
      if (!('webhookHashEnc' in set)) onInsert.webhookHashEnc = null
    }
    await configs.findOneAndUpdate(
      { provider },
      { $set: { provider, ...set }, ...(Object.keys(onInsert).length ? { $setOnInsert: onInsert } : {}) },
      { upsert: true },
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const provider = oneOf(new URL(request.url).searchParams.get('provider'), 'provider', ['paystack', 'flutterwave'] as const)
    const configs = await scopedCollection<PaymentConfigDoc>(ctx, 'payment_configs')
    await configs.deleteMany({ provider })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
