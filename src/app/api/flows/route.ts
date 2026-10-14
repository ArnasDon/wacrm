import { accountRoute, readObject } from '@/lib/api/local-route';
import { createFlow, listFlows, parseFlowInput } from '@/lib/db/flows';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    flows: await listFlows(db, ctx.accountId),
  }));
}
export async function POST(request: Request) {
  const response = await accountRoute(request, 'agent', async (db, ctx) => ({
    flow: await createFlow(db, ctx, parseFlowInput(await readObject(request))),
  }));
  return response.ok
    ? new Response(response.body, { status: 201, headers: response.headers })
    : response;
}
