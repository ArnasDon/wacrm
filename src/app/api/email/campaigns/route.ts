import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { createCampaign, getCampaigns } from '@/lib/listmonk/client';
import { toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';

/** GET /api/email/campaigns */
export async function GET(request: Request) {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const page = Number(new URL(request.url).searchParams.get('page') ?? '1');

  try {
    const result = await getCampaigns({
      page: Number.isInteger(page) && page > 0 ? page : 1,
      per_page: 50,
    });
    return NextResponse.json({
      campaigns: result.results,
      total: result.total,
      page: result.page,
    });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}

/**
 * POST /api/email/campaigns — create a draft.
 *
 * Creating is `agent`-level (same bar as sending a WhatsApp
 * broadcast); actually *starting* the send is gated separately in
 * the status route.
 */
export async function POST(request: Request) {
  try {
    await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const content = typeof body.body === 'string' ? body.body : '';
  const lists = Array.isArray(body.lists)
    ? body.lists.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!subject) {
    return NextResponse.json({ error: 'subject is required' }, { status: 400 });
  }
  if (lists.length === 0) {
    return NextResponse.json(
      { error: 'at least one list is required' },
      { status: 400 }
    );
  }

  try {
    const campaign = await createCampaign({
      name,
      subject,
      lists,
      body: content,
      content_type: body.content_type === 'plain' ? 'plain' : 'richtext',
      ...(body.template_id ? { template_id: Number(body.template_id) } : {}),
      ...(body.from_email ? { from_email: String(body.from_email) } : {}),
      ...(body.send_at ? { send_at: String(body.send_at) } : {}),
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
