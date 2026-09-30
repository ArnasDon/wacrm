// POST /api/campaigns/audience-preview — the wizard's "audience health"
// for contact-based audiences (all / tags / segment): how many contacts
// match, and how many are removed as invalid numbers, duplicates or by
// the exclude tags. Uploaded / pasted rows are checked in the browser.

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { resolveAudience, type AudienceSpec } from '@/lib/campaigns/audience';

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('agent');
    const a = (await request.json().catch(() => ({}))) ?? {};
    const source = ['all', 'tags', 'segment'].includes(a.source)
      ? a.source
      : null;
    if (!source)
      return NextResponse.json(
        { error: 'Unsupported audience source' },
        { status: 400 }
      );

    const spec: AudienceSpec = {
      source,
      tagIds: Array.isArray(a.tagIds) ? a.tagIds : [],
      tagMatch: a.tagMatch === 'all' ? 'all' : 'any',
      segment: a.segment,
      excludeTagIds: Array.isArray(a.excludeTagIds) ? a.excludeTagIds : [],
    };
    const r = await resolveAudience(supabaseAdmin(), accountId, spec);
    return NextResponse.json({
      total: r.total,
      valid: r.recipients.length,
      invalid: r.invalid,
      duplicates: r.duplicates,
      excluded: r.excluded,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
