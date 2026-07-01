import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify conversation ownership
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (convError || !conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Fetch last 50 messages
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('sender_type, content_type, content_text')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (msgError) throw msgError

    if (!messages || messages.length === 0) {
      return NextResponse.json({ summary: 'No messages to summarize.' })
    }

    // Format for AI
    const conversationText = messages
      .reverse()
      .map(m => `[${m.sender_type.toUpperCase()}]: ${m.content_type === 'text' ? m.content_text : `[${m.content_type}]`}`)
      .join('\n')

    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenRouter API key not configured' }, { status: 500 })
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-pro', // A fast/cheap default, user can change
        messages: [
          {
            role: 'system',
            content: 'You are a helpful CRM assistant. Summarize the following customer service conversation briefly in 2-3 sentences.'
          },
          {
            role: 'user',
            content: conversationText
          }
        ]
      })
    })

    if (!response.ok) {
      throw new Error('Failed to generate summary from OpenRouter')
    }

    const aiData = await response.json()
    const summary = aiData.choices[0]?.message?.content || 'Could not generate summary.'

    return NextResponse.json({ summary })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
