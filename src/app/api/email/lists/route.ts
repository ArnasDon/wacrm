import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { createList, getLists } from '@/lib/listmonk/client';
import { accountListTag } from '@/lib/listmonk/sync';
import { toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';

/** GET /api/email/lists — mailing lists. */
export async function GET() {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  try {
    const page = await getLists({ per_page: 100 });
    return NextResponse.json({ lists: page.results, total: page.total });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}

/** POST /api/email/lists — create a list. */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const type = body.type === 'public' ? 'public' : 'private';
  const optin = body.optin === 'double' ? 'double' : 'single';

  try {
    const list = await createList({
      name,
      type,
      optin,
      // Stamp the owning account so the Email section can tell lists
      // this CRM manages from ones made directly in listmonk.
      tags: [accountListTag(ctx.accountId)],
      description: typeof body.description === 'string' ? body.description : '',
    });
    return NextResponse.json({ list }, { status: 201 });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
