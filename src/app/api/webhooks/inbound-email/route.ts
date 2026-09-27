import { NextResponse } from 'next/server';
import { findActiveKeyByHash } from '@/lib/api-keys/store';
import { hashApiKey, looksLikeApiKey } from '@/lib/api-keys/keys';
import { parseInboundEmail } from '@/lib/inbound-email/parser';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  resolveAuditUserId,
  findOrCreateContact,
  setContactTags,
  ContactError
} from '@/lib/api/v1/contacts';

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

    if (!text && !subject) {
      return NextResponse.json({ ok: true });
    }

    const lead = await parseInboundEmail(keyRow.account_id, subject, text);

    if (lead && lead.phone) {
      const db = supabaseAdmin();
      const accountId = keyRow.account_id;

      try {
        const auditUserId = await resolveAuditUserId(db, accountId);

        const { id, created } = await findOrCreateContact(
          db,
          accountId,
          auditUserId,
          {
            phone: lead.phone,
            name: lead.name,
            email: lead.email,
          }
        );

        if (lead.source) {
          if (created) {
            await setContactTags(db, accountId, auditUserId, id, [lead.source]);
          } else {
            // Safely append the tag for an existing contact to avoid wiping their existing tags
            const { data: currentTags } = await db
              .from('contact_tags')
              .select('tags(name)')
              .eq('contact_id', id);
            
            const existingTagNames = (currentTags || [])
              .map(t => (t.tags as unknown as { name: string })?.name)
              .filter(Boolean);
            
            if (!existingTagNames.includes(lead.source)) {
              await setContactTags(db, accountId, auditUserId, id, [...existingTagNames, lead.source]);
            }
          }
        }
      } catch (err) {
        if (err instanceof ContactError) {
          console.warn('[inbound-email] Lead creation failed:', err.message);
          // Return 200 so SendGrid doesn't retry a bad payload
          return NextResponse.json({ ok: true, warn: err.message }, { status: 200 });
        }
        throw err;
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
