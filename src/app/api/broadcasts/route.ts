import { after } from 'next/server';
import {
  accountRoute,
  readObject,
  localErrorResponse,
} from '@/lib/api/local-route';
import { withAccount } from '@/lib/db/context';
import { getPool } from '@/lib/db/pool';
import { BroadcastStore } from '@/lib/db/broadcasts';
import { requireBroadcastSession } from '@/lib/whatsapp/broadcast-session';
import { createDashboardBroadcast } from '@/lib/whatsapp/create-dashboard-broadcast';
import {
  deliverBroadcast,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';
export const maxDuration = 300;
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    broadcasts: await new BroadcastStore(db, ctx.accountId).list(),
  }));
}
export async function POST(request: Request) {
  try {
    const ctx = await requireBroadcastSession(request);
    const body = await readObject(request);
    const { campaign, plan } = await withAccount(ctx, (db) =>
      createDashboardBroadcast(db, ctx, body)
    );
    if (plan) after(() => deliverBroadcast(getPool('worker'), plan));
    return Response.json(
      { broadcast_id: campaign.id, status: campaign.status },
      { status: plan ? 202 : 201 }
    );
  } catch (error) {
    if (error instanceof BroadcastError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    return localErrorResponse(error);
  }
}
