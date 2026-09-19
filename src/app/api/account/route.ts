import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { getDb } from '@/lib/db/mongo'
import type { AccountDoc } from '@/lib/db/types'
import { readJson } from '@/lib/http/errors'
import { str } from '@/lib/http/validate'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    return NextResponse.json({ account: ctx.account, role: ctx.role })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** PATCH — rename the account. Admin+. */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await readJson(request)
    const name = str(body.name, 'name', { max: 120 })
    const db = await getDb()
    await db
      .collection<AccountDoc>('accounts')
      .updateOne({ _id: ctx.accountId }, { $set: { name, updatedAt: new Date() } })
    return NextResponse.json({ account: { id: ctx.accountId, name } })
  } catch (err) {
    return toErrorResponse(err)
  }
}
