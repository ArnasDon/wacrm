import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  deleteTemplate,
  getTemplate,
  updateTemplate,
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
    return NextResponse.json({ template: await getTemplate(id) });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const name = String(body.name ?? '').trim();
  const type = body.type === 'tx' ? 'tx' : 'campaign';
  const content = String(body.body ?? '');
  const subject = String(body.subject ?? '').trim();

  if (!name)
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!content.trim()) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }
  if (type === 'tx' && !subject) {
    return NextResponse.json(
      { error: 'subject is required for transactional templates' },
      { status: 400 }
    );
  }
  if (
    type === 'campaign' &&
    !/\{\{\s*template\s+"content"\s+\.\s*\}\}/.test(content)
  ) {
    return NextResponse.json(
      {
        error:
          'Campaign templates must include the {{ template "content" . }} placeholder — that is where each campaign\'s body is inserted.',
      },
      { status: 400 }
    );
  }

  try {
    const template = await updateTemplate(id, {
      name,
      type,
      body: content,
      subject,
    });
    return NextResponse.json({ template });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  try {
    await deleteTemplate(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
