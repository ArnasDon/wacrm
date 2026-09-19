import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadAccount } from '@/lib/auth/accounts'
import { getDb } from '@/lib/db/mongo'
import type { AccountDoc, BusinessProfile } from '@/lib/db/types'
import { NotFoundError, readJson, ValidationError } from '@/lib/http/errors'
import { num, oneOf, optStr, str } from '@/lib/http/validate'

/** GET — business profile (branding on invoices, receipts, payment pages). */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const account = await loadAccount(ctx.accountId)
    if (!account) throw new NotFoundError('Account not found')
    return NextResponse.json({ business: account.business, currency: account.currency, accountName: account.name })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH — edit the profile. Admin+. Money/tax fields are validated. */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await readJson(request)
    const set: Record<string, unknown> = {}
    const field = (key: keyof BusinessProfile, max: number) => {
      if (key in body) set[`business.${key}`] = optStr(body[key], key, max)
    }
    if ('displayName' in body) set['business.displayName'] = str(body.displayName, 'displayName', { max: 120 })
    field('legalName', 160)
    field('address', 300)
    field('phone', 40)
    field('website', 200)
    field('taxId', 60)
    field('invoiceNotes', 600)
    field('receiptFooter', 600)
    if ('email' in body) {
      const e = optStr(body.email, 'email', 254)
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ValidationError('email is not valid')
      set['business.email'] = e
    }
    if ('taxRatePercent' in body) {
      set['business.taxRateBps'] = Math.round(num(body.taxRatePercent ?? 0, 'taxRatePercent', { min: 0, max: 50 }) * 100)
    }
    if ('bank' in body && body.bank && typeof body.bank === 'object') {
      const b = body.bank as Record<string, unknown>
      const accountNumber = optStr(b.accountNumber, 'bank.accountNumber', 20)
      if (accountNumber && !/^\d{10}$/.test(accountNumber)) throw new ValidationError('Account number must be 10 digits (NUBAN)')
      set['business.bank'] = {
        bankName: optStr(b.bankName, 'bank.bankName', 80),
        accountName: optStr(b.accountName, 'bank.accountName', 120),
        accountNumber,
      }
    }
    if ('currency' in body) set.currency = oneOf(body.currency, 'currency', ['NGN', 'GHS', 'KES', 'ZAR', 'USD'] as const)
    if (Object.keys(set).length === 0) throw new ValidationError('Nothing to update')
    const db = await getDb()
    await db.collection<AccountDoc>('accounts').updateOne({ _id: ctx.accountId }, { $set: { ...set, updatedAt: new Date() } })
    const account = await loadAccount(ctx.accountId)
    return NextResponse.json({ business: account?.business, currency: account?.currency })
  } catch (err) {
    return toErrorResponse(err)
  }
}
