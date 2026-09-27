import { NextResponse } from 'next/server';
import { findActiveKeyByHash } from '@/lib/api-keys/store';
import { hashApiKey, looksLikeApiKey } from '@/lib/api-keys/keys';
import { parseInboundEmail } from '@/lib/inbound-email/parser';

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token || !looksLikeApiKey(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const keyRow = await findActiveKeyByHash(hashApiKey(token));
    if (!keyRow) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Must have write contacts scope
    if (!keyRow.scopes.includes('contacts:write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
    }

    const subject = formData.get('subject')?.toString() || '';
    const text =
      formData.get('text')?.toString() ||
      formData.get('html')?.toString() ||
      '';
    // SendGrid parse sends `from` but we might not need it for extraction

    if (!text && !subject) {
      // Nothing to parse
      return NextResponse.json({ ok: true });
    }

    const lead = await parseInboundEmail(keyRow.account_id, subject, text);

    if (lead) {
      // M3: Write extracted leads into contacts via the existing public API
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const res = await fetch(`${siteUrl}/api/v1/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          tags: [lead.source],
        }),
      });

      if (!res.ok) {
        console.error(
          '[inbound-email] Failed to create contact via public API',
          await res.text()
        );
        return NextResponse.json(
          { error: 'Internal Server Error' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[inbound-email] Error processing webhook:', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
