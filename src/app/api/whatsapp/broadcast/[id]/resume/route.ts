import { after } from 'next/server';
import {
  readObject,
  requireUUID,
  localErrorResponse,
  RequestError,
} from '@/lib/api/local-route';
import { withAccount } from '@/lib/db/context';
import { getPool } from '@/lib/db/pool';
import { BroadcastStore } from '@/lib/db/broadcasts';
import { requireBroadcastSession } from '@/lib/whatsapp/broadcast-session';
import {
  planBroadcastResume,
  RESUME_SCOPES,
  type ResumeScope,
} from '@/lib/whatsapp/broadcast-resume';
import {
  deliverBroadcast,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';
export const maxDuration = 300;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireBroadcastSession(request);
    const id = requireUUID((await params).id);
    const body = await readObject(request);
    const scope: ResumeScope = RESUME_SCOPES.includes(body.scope as ResumeScope)
      ? (body.scope as ResumeScope)
      : 'pending';
    const result = await withAccount(ctx, async (db) => {
      const store = new BroadcastStore(db, ctx.accountId);
      if (!(await store.claim(id)))
        throw new RequestError(
          'A delivery pass is already running or the broadcast is unavailable.',
          409
        );
      const result = await planBroadcastResume(db, ctx.accountId, id, scope);
      await store.sending(id);
      return result;
    });
    after(() => deliverBroadcast(getPool('worker'), result.plan));
    return Response.json(
      {
        success: true,
        broadcast_id: id,
        scope,
        resuming: result.plan.planned.length,
        remaining: result.remaining,
        unsendable: result.unsendable,
      },
      { status: 202 }
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
