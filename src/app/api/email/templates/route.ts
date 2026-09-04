import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { createTemplate, getTemplates } from '@/lib/listmonk/client';
import { toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';

/**
 * GET /api/email/templates?type=tx|campaign|all
 *
 * Defaults to campaign templates (what the newsletter composer wants).
 * The automation/flow builders ask for `tx`; the Templates page asks
 * for `all`.
 */
export async function GET(request: Request) {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const type = new URL(request.url).searchParams.get('type') ?? 'campaign';

  try {
    const all = await getTemplates();
    const templates =
      type === 'all'
        ? all
        : type === 'tx'
          ? all.filter((t) => t.type === 'tx')
          : all.filter((t) => t.type !== 'tx');
    return NextResponse.json({ templates });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}

/** POST /api/email/templates — create. Admin: templates are shared. */
export async function POST(request: Request) {
  try {
    await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

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
  // listmonk enforces this too, but its message is a translation key;
  // say it plainly here so the editor can point at the fix.
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
    const template = await createTemplate({
      name,
      type,
      body: content,
      subject,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
