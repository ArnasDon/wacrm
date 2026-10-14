import { accountRoute, readObject } from '@/lib/api/local-route';
import {
  createAutomation,
  listAutomations,
  parseAutomationInput,
} from '@/lib/db/automations';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    automations: await listAutomations(db, ctx.accountId),
  }));
}
export async function POST(request: Request) {
  const response = await accountRoute(request, 'agent', async (db, ctx) => ({
    automation: await createAutomation(
      db,
      ctx,
      parseAutomationInput(await readObject(request))
    ),
  }));
  return response.ok
    ? new Response(response.body, { status: 201, headers: response.headers })
    : response;
}
