import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('quick_replies')
      .select('*')
      .order('shortcut', { ascending: true })

    if (error) throw error

    return NextResponse.json({ quickReplies: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { shortcut, content } = body

    if (!shortcut || !content) {
      return NextResponse.json({ error: 'Missing shortcut or content' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('quick_replies')
      .insert({
        user_id: user.id,
        shortcut: shortcut.toLowerCase(),
        content
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ quickReply: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
