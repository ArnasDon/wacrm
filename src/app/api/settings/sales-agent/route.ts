import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAccount } from '@/lib/auth/accounts'
import { isId } from '@/lib/db/ids'
import { getDb } from '@/lib/db/mongo'
import { scopedCollection } from '@/lib/db/scoped'
import type { AccountDoc, AIProviderDoc } from '@/lib/db/types'
import { NotFoundError, readJson, ValidationError } from '@/lib/http/errors'
import { bool, num, oneOf, str, strList } from '@/lib/http/validate'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const account = await loadAccount(ctx.accountId)
    if (!account) throw new NotFoundError('Account not found')
    return NextResponse.json({ salesAgent: account.salesAgent, currency: account.currency })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH — sales rep behaviour. Admin+. Money fields in major units. */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await readJson(request)
    const set: Record<string, unknown> = {}
    if ('name' in body) set['salesAgent.name'] = str(body.name, 'name', { max: 40 })
    if ('enabled' in body) set['salesAgent.enabled'] = bool(body.enabled, 'enabled')
    if ('mode' in body) set['salesAgent.mode'] = oneOf(body.mode, 'mode', ['ai', 'rules'] as const)
    if ('aiProviderId' in body) {
      if (body.aiProviderId === null || body.aiProviderId === '') {
        set['salesAgent.aiProviderId'] = null
      } else {
        if (!isId(body.aiProviderId)) throw new ValidationError('Invalid AI provider')
        const providers = await scopedCollection<AIProviderDoc>(ctx, 'ai_providers')
        if (!(await providers.findById(body.aiProviderId))) throw new ValidationError('AI provider not found')
        set['salesAgent.aiProviderId'] = body.aiProviderId
      }
    }
    if ('instructions' in body) set['salesAgent.instructions'] = str(body.instructions, 'instructions', { max: 4000 })
    if ('greeting' in body) set['salesAgent.greeting'] = str(body.greeting, 'greeting', { max: 500, optional: true })
    if ('priceListKeywords' in body) set['salesAgent.priceListKeywords'] = strList(body.priceListKeywords, 'priceListKeywords', 30, 40)
    if ('handoffKeywords' in body) set['salesAgent.handoffKeywords'] = strList(body.handoffKeywords, 'handoffKeywords', 30, 40)
    if ('paymentProvider' in body) {
      set['salesAgent.paymentProvider'] = oneOf(body.paymentProvider, 'paymentProvider', ['paystack', 'flutterwave', 'bank_transfer'] as const)
    }
    if ('autoSendPaymentLink' in body) set['salesAgent.autoSendPaymentLink'] = bool(body.autoSendPaymentLink, 'autoSendPaymentLink')
    if ('deliveryFee' in body) set['salesAgent.deliveryFee'] = Math.round(num(body.deliveryFee ?? 0, 'deliveryFee', { min: 0, max: 10_000_000 }) * 100)
    if ('approvalThreshold' in body) {
      set['salesAgent.approvalThreshold'] = Math.round(num(body.approvalThreshold ?? 0, 'approvalThreshold', { min: 0, max: 1_000_000_000 }) * 100)
    }
    if (Object.keys(set).length === 0) throw new ValidationError('Nothing to update')
    const db = await getDb()
    await db.collection<AccountDoc>('accounts').updateOne({ _id: ctx.accountId }, { $set: { ...set, updatedAt: new Date() } })
    const account = await loadAccount(ctx.accountId)
    return NextResponse.json({ salesAgent: account?.salesAgent })
  } catch (err) {
    return toErrorResponse(err)
  }
}
