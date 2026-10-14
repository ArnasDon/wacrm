import { accountRoute, requireUUID, RequestError } from '@/lib/api/local-route';
import { duplicateAutomation } from '@/lib/db/automations';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const response = await accountRoute(request, 'agent', async (db, ctx) => {
    const automation = await duplicateAutomation(
      db,
      ctx,
      requireUUID((await params).id)
    );
    if (!automation) throw new RequestError('Automation not found.', 404);
    return { automation };
  });
  return response.ok
    ? new Response(response.body, { status: 201, headers: response.headers })
    : response;
}
