import { Binary } from 'mongodb'
import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { getDb } from '@/lib/db/mongo'
import { scopedCollection } from '@/lib/db/scoped'
import type { AccountAssetDoc, AccountDoc } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/http/errors'

const MAX_BYTES = 512 * 1024

/** Identify PNG/JPEG by magic bytes — never trust the declared type. */
function sniff(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}

/** GET — the logo image (any member; used in the UI preview). */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const assets = await scopedCollection<AccountAssetDoc>(ctx, 'account_assets')
    const logo = await assets.findOne({ kind: 'logo' })
    if (!logo) throw new NotFoundError('No logo')
    return new Response(new Uint8Array(logo.data.buffer), {
      headers: { 'content-type': logo.mime, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST multipart (field "file") — PNG or JPEG up to 512 KB. Admin+. SVG refused (can carry script). */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') throw new ValidationError('Upload a PNG or JPEG file in the "file" field')
    if (file.size > MAX_BYTES) throw new ValidationError('Logo must be 512 KB or smaller')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const mime = sniff(bytes)
    if (!mime) throw new ValidationError('Logo must be a PNG or JPEG image')

    const assets = await scopedCollection<AccountAssetDoc>(ctx, 'account_assets')
    await assets.findOneAndUpdate(
      { kind: 'logo' },
      { $set: { kind: 'logo', mime, size: bytes.length, data: new Binary(Buffer.from(bytes)) } },
      { upsert: true },
    )
    const db = await getDb()
    await db
      .collection<AccountDoc>('accounts')
      .updateOne({ _id: ctx.accountId }, { $set: { 'business.hasLogo': true, updatedAt: new Date() }, $inc: { 'business.logoVersion': 1 } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin')
    const assets = await scopedCollection<AccountAssetDoc>(ctx, 'account_assets')
    await assets.deleteMany({ kind: 'logo' })
    const db = await getDb()
    await db
      .collection<AccountDoc>('accounts')
      .updateOne({ _id: ctx.accountId }, { $set: { 'business.hasLogo': false, updatedAt: new Date() }, $inc: { 'business.logoVersion': 1 } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
