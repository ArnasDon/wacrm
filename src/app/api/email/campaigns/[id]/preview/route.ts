import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { previewCampaign } from '@/lib/listmonk/client';
import { parseId, toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';

/**
 * POST /api/email/campaigns/:id/preview
 *
 * Returns the rendered HTML for a draft body, so the composer can
 * show what recipients will actually receive.
 *
 * The HTML is campaign content, not part of this app's UI — it is
 * rendered client-side inside a sandboxed iframe, never injected
 * into the CRM's own document.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  try {
    const html = await previewCampaign(id, {
      body: String(body.body ?? ''),
      content_type: body.content_type === 'plain' ? 'plain' : 'richtext',
      ...(body.template_id ? { template_id: Number(body.template_id) } : {}),
    });
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
