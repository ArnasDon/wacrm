import { NextResponse } from 'next/server'
import { getCurrentAccount } from '@/lib/auth/account'
import { getDb } from '@/lib/db/mongo'
import { scopedCollection } from '@/lib/db/scoped'
import type { EmailAccountDoc, OAuthStateDoc } from '@/lib/db/types'
import { getAppBaseUrl } from '@/lib/http/base-url'
import { encrypt } from '@/lib/security/secrets'

/** GET — Google redirects here with ?code&state. */
export async function GET(request: Request) {
  const base = getAppBaseUrl(request)
  const back = (status: string) => NextResponse.redirect(`${base}/settings?tab=email&gmail=${status}`, 303)
  try {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (!code || !state || state.length > 100) return back('error')

    // The signed-in user must be the one who started the flow.
    const me = await getCurrentAccount().catch(() => null)
    if (!me) return back('signin')
    const db = await getDb()
    const claimed = await db
      .collection<OAuthStateDoc>('oauth_states')
      .findOneAndDelete({ _id: state, purpose: 'gmail', expiresAt: { $gt: new Date() } })
    if (!claimed || claimed.accountId !== me.accountId || claimed.userId !== me.userId) return back('error')

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${base}/api/integrations/gmail/callback`,
        grant_type: 'authorization_code',
      }),
    })
    const tokens = (await tokenRes.json().catch(() => ({}))) as {
      refresh_token?: string
      access_token?: string
      scope?: string
    }
    if (!tokenRes.ok || !tokens.refresh_token || !tokens.access_token) return back('error')
    if (!tokens.scope?.includes('gmail.send')) return back('scope')

    const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    }).then((r) => r.json() as Promise<{ email?: string; email_verified?: boolean }>)
    if (!info.email || info.email_verified === false) return back('error')

    const accounts = await scopedCollection<EmailAccountDoc>(me, 'email_accounts')
    const isFirst = (await accounts.countDocuments({})) === 0
    const existing = await accounts.findOne({ provider: 'gmail', fromEmail: info.email.toLowerCase() })
    if (existing) {
      await accounts.updateById(existing._id, {
        $set: { gmail: { refreshTokenEnc: encrypt(tokens.refresh_token), scope: tokens.scope }, lastTestOk: null },
      })
    } else {
      await accounts.insertOne({
        provider: 'gmail',
        label: `Gmail — ${info.email}`,
        fromName: me.account.name,
        fromEmail: info.email.toLowerCase(),
        isDefault: isFirst,
        smtp: null,
        gmail: { refreshTokenEnc: encrypt(tokens.refresh_token), scope: tokens.scope },
        lastTestAt: null,
        lastTestOk: null,
      })
    }
    return back('connected')
  } catch (err) {
    console.error('[gmail] callback failed', err)
    return back('error')
  }
}
