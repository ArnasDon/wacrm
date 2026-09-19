import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { generateJSON, AIProviderError } from '@/lib/ai/client'
import { getPreset } from '@/lib/ai/presets'
import { parseId } from '@/lib/db/ids'
import { getDb } from '@/lib/db/mongo'
import { scopedCollection } from '@/lib/db/scoped'
import type { AccountDoc, AIProviderDoc } from '@/lib/db/types'
import { NotFoundError, readJson, ValidationError } from '@/lib/http/errors'
import { bool, optStr } from '@/lib/http/validate'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/security/secrets'
import { shapeProvider, validateBaseUrl } from '@/lib/ai/provider-admin'

type Params = { params: Promise<{ id: string }> }

/** PATCH { label?, apiKey?, model?, baseUrl?, isDefault? } — Admin+. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const id = parseId((await params).id)
    const body = await readJson(request)
    const providers = await scopedCollection<AIProviderDoc>(ctx, 'ai_providers')
    const existing = await providers.findById(id)
    if (!existing) throw new NotFoundError('AI provider not found')
    const preset = getPreset(existing.preset)
    const set: Partial<AIProviderDoc> = {}
    if ('label' in body) set.label = optStr(body.label, 'label', 80) ?? existing.label
    if ('apiKey' in body && body.apiKey) set.apiKeyEnc = encrypt(optStr(body.apiKey, 'apiKey', 400)!)
    if ('model' in body) {
      const model = optStr(body.model, 'model', 120)
      if (!model || !/^[\w.:/@-]{1,120}$/.test(model)) throw new ValidationError('Invalid model name')
      set.model = model
    }
    if ('baseUrl' in body && preset?.customBaseUrl) set.baseUrl = await validateBaseUrl(optStr(body.baseUrl, 'baseUrl', 300))
    if ('isDefault' in body && bool(body.isDefault, 'isDefault')) {
      await providers.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } })
      set.isDefault = true
    }
    const updated = await providers.findOneAndUpdate({ _id: id }, { $set: { ...set, lastTestOk: null, lastTestError: null } })
    return NextResponse.json({ provider: shapeProvider(updated!) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const id = parseId((await params).id)
    const providers = await scopedCollection<AIProviderDoc>(ctx, 'ai_providers')
    const res = await providers.deleteOne({ _id: id })
    if (res.deletedCount === 0) throw new NotFoundError('AI provider not found')
    // Detach from the sales rep if it was selected.
    const db = await getDb()
    await db
      .collection<AccountDoc>('accounts')
      .updateOne({ _id: ctx.accountId, 'salesAgent.aiProviderId': id }, { $set: { 'salesAgent.aiProviderId': null, 'salesAgent.mode': 'rules' } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST — test the connection with a tiny JSON request. Admin+. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`integration:${ctx.userId}`, RATE_LIMITS.integrationTest)
    if (!limit.success) return rateLimitResponse(limit)
    const id = parseId((await params).id)
    const providers = await scopedCollection<AIProviderDoc>(ctx, 'ai_providers')
    const provider = await providers.findById(id)
    if (!provider) throw new NotFoundError('AI provider not found')
    const started = Date.now()
    let ok = false
    let message = ''
    try {
      const out = (await generateJSON(provider, {
        system: 'You are a connectivity check. Reply with JSON only.',
        messages: [{ role: 'user', content: 'Reply with {"ok": true, "greeting": "<a 3-word hello>"}' }],
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['ok', 'greeting'],
          properties: { ok: { type: 'boolean' }, greeting: { type: 'string' } },
        },
        maxTokens: 1500,
      })) as { ok?: boolean; greeting?: string }
      ok = out?.ok === true
      message = ok ? `Connected — "${String(out.greeting ?? '').slice(0, 60)}"` : 'Model replied but not in the expected format'
    } catch (err) {
      message = err instanceof AIProviderError ? err.message : 'Could not reach the provider'
    }
    await providers.updateById(id, { $set: { lastTestAt: new Date(), lastTestOk: ok, lastTestError: ok ? null : message } })
    return NextResponse.json({ ok, message, latencyMs: Date.now() - started })
  } catch (err) {
    return toErrorResponse(err)
  }
}
