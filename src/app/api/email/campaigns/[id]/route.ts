import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  deleteCampaign,
  getCampaign,
  updateCampaign,
} from '@/lib/listmonk/client';
import { parseId, toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    return NextResponse.json({ campaign: await getCampaign(id) });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const lists = Array.isArray(body.lists)
    ? body.lists.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  if (lists.length === 0) {
    return NextResponse.json(
      { error: 'at least one list is required' },
      { status: 400 }
    );
  }

  try {
    const campaign = await updateCampaign(id, {
      name: String(body.name ?? '').trim(),
      subject: String(body.subject ?? '').trim(),
      lists,
      body: String(body.body ?? ''),
      content_type: body.content_type === 'plain' ? 'plain' : 'richtext',
      ...(body.template_id ? { template_id: Number(body.template_id) } : {}),
      ...(body.from_email ? { from_email: String(body.from_email) } : {}),
      send_at: body.send_at ? String(body.send_at) : null,
    });
    return NextResponse.json({ campaign });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  // Destructive and irreversible — admin, not agent.
  try {
    await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  try {
    await deleteCampaign(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
