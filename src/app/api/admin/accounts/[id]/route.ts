import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { parseId } from '@/lib/db/ids'
import { getDb } from '@/lib/db/mongo'
import { accountDetail, deleteAccountCascade } from '@/lib/db/platform'
import type { AccountDoc } from '@/lib/db/types'
import { NotFoundError, readJson, toErrorResponse, ValidationError } from '@/lib/http/errors'
import { optStr } from '@/lib/http/validate'

type Params = { params: Promise<{ id: string }> }

/** GET — one merchant: people, integrations, recent AI runs and orders. */
export async function GET(_request: Request, { params }: Params) {
  try {
    await requirePlatformAdmin()
    const id = parseId((await params).id)
    const detail = await accountDetail(id)
    if (!detail) throw new NotFoundError('Account not found')
    const { account, users, providers, recentRuns, orders } = detail
    return NextResponse.json({
      account: {
        id: account._id,
        name: account.name,
        business: account.business,
        currency: account.currency,
        createdAt: account.createdAt,
        suspendedAt: account.suspendedAt ?? null,
        suspendedReason: account.suspendedReason ?? null,
        salesAgent: {
          enabled: account.salesAgent.enabled,
          mode: account.salesAgent.mode,
          name: account.salesAgent.name,
          aiProviderId: account.salesAgent.aiProviderId,
        },
      },
      users: users.map((u) => ({
        id: u._id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      })),
      providers: providers.map((p) => ({
        id: p._id,
        label: p.label,
        model: p.model,
        lastTestOk: p.lastTestOk,
        lastTestError: p.lastTestError ?? null,
      })),
      recentRuns,
      orders,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH { suspended, reason? } — switch a merchant off or back on. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    await requirePlatformAdmin()
    const id = parseId((await params).id)
    const body = await readJson(request)
    if (typeof body.suspended !== 'boolean') throw new ValidationError('suspended must be true or false')
    const reason = optStr(body.reason, 'reason', 200)

    const db = await getDb()
    const res = await db.collection<AccountDoc>('accounts').updateOne(
      { _id: id },
      {
        $set: body.suspended
          ? { suspendedAt: new Date(), suspendedReason: reason ?? null, updatedAt: new Date() }
          : { suspendedAt: null, suspendedReason: null, updatedAt: new Date() },
      },
    )
    if (res.matchedCount === 0) throw new NotFoundError('Account not found')
    return NextResponse.json({ ok: true, suspended: body.suspended })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE ?confirm=<account name> — remove a merchant and their data.
 * The name has to be typed back, because there is no undo: the orders,
 * conversations and receipts all go with it.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    await requirePlatformAdmin()
    const id = parseId((await params).id)
    const db = await getDb()
    const account = await db.collection<AccountDoc>('accounts').findOne({ _id: id }, { projection: { name: 1 } })
    if (!account) throw new NotFoundError('Account not found')

    const confirm = new URL(request.url).searchParams.get('confirm')
    if (confirm?.trim().toLowerCase() !== account.name.trim().toLowerCase()) {
      throw new ValidationError(`Type the account name (${account.name}) to confirm deletion`)
    }
    const removed = await deleteAccountCascade(id)
    return NextResponse.json({ ok: true, removed })
  } catch (err) {
    return toErrorResponse(err)
  }
}
