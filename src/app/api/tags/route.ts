import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('tags')
      .select('id, name, color')
      .eq('account_id', accountId)
      .order('name')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ tags: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
