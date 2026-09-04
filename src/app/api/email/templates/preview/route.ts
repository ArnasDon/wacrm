import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { previewTemplateBody } from '@/lib/listmonk/client';
import { toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';

/**
 * POST /api/email/templates/preview  { body, type }
 *
 * Renders an unsaved template with dummy data. Returned as text and
 * shown in a sandboxed iframe — template HTML is content, never part
 * of the CRM's own document.
 */
export async function POST(request: Request) {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }
  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  try {
    const html = await previewTemplateBody({
      body: String(body.body ?? ''),
      type: body.type === 'tx' ? 'tx' : 'campaign',
    });
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
