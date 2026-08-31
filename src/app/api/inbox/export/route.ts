import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from '@/lib/inbox/conversations';

export const dynamic = 'force-dynamic';

const CSV_HEADER =
  'Name,Phone,Email,Company,Tags,Conversation Status,Last Reply,Last Reply Type,Last Reply At';

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function displayReply(text: string | null, type: string): string {
  if (text && text.trim()) return text;
  return `[${type}]`;
}

function csvResponse(body: string): Response {
  const filename = `inbox-replies-${new Date().toISOString().slice(0, 10)}.csv`;
  // Prepend UTF-8 BOM (\uFEFF) so Excel opens non-ASCII characters correctly.
  return new Response('\uFEFF' + body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1. Fetch conversations with joined contact and tags. RLS scopes to caller's account.
  const { data: convRows, error: convErr } = await supabase
    .from('conversations')
    .select(CONVERSATION_SELECT)
    .order('last_message_at', { ascending: false });

  if (convErr) {
    console.error('[inbox-export] conversations query failed:', convErr);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }

  const conversations = normalizeConversations(convRows ?? []);
  const convIds = conversations.map((c) => c.id);
  if (convIds.length === 0) {
    return csvResponse(CSV_HEADER + '\n');
  }

  // 2. Fetch customer messages for these conversations, ascending by created_at.
  const { data: msgRows, error: msgErr } = await supabase
    .from('messages')
    .select('conversation_id, content_text, content_type, created_at')
    .in('conversation_id', convIds)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: true });

  if (msgErr) {
    console.error('[inbox-export] messages query failed:', msgErr);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }

  // Ascending order + last-wins map reduce leaves the newest customer message per conversation.
  const latestByConv = new Map<
    string,
    { content_text: string | null; content_type: string; created_at: string }
  >();
  for (const m of msgRows ?? []) {
    latestByConv.set(m.conversation_id, m);
  }

  // 3. Build CSV rows for conversations that have at least one customer reply.
  const lines = [CSV_HEADER];
  for (const conv of conversations) {
    const reply = latestByConv.get(conv.id);
    if (!reply) continue; // Exclude conversations with no customer reply

    const c = conv.contact;
    const tags = (c?.tags ?? []).map((t) => t.name).join('; ');
    lines.push(
      [
        c?.name ?? '',
        c?.phone ?? '',
        c?.email ?? '',
        c?.company ?? '',
        tags,
        conv.status ?? '',
        displayReply(reply.content_text, reply.content_type),
        reply.content_type,
        reply.created_at,
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  return csvResponse(lines.join('\n') + '\n');
}
