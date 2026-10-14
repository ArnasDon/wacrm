import {
  accountRoute,
  readObject,
  RequestError,
  requireUUID,
} from '@/lib/api/local-route';
import { queryRows } from '@/lib/db/rows';
import { setContactTag } from '@/lib/db/contacts';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import type { ContactTag } from '@/types';

type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, { params }: Context) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    tags: await queryRows<ContactTag>(
      db,
      `SELECT ct.id,ct.contact_id,ct.tag_id FROM public.contact_tags ct JOIN public.contacts c ON c.id=ct.contact_id
     WHERE c.account_id=$1 AND c.id=$2`,
      [ctx.accountId, requireUUID((await params).id)]
    ),
  }));
}
export function POST(request: Request, { params }: Context) {
  let contactId: string;
  let tagId: string;
  return accountRoute(
    request,
    'agent',
    async (db, ctx) => {
      contactId = requireUUID((await params).id);
      tagId = requireUUID((await readObject(request)).tag_id);
      const added = await setContactTag(
        db,
        ctx.accountId,
        contactId,
        tagId,
        true
      );
      return {
        ok: true,
        added,
        dispatched: false,
        ...(added ? {} : { reason: 'duplicate' as const }),
      };
    },
    async (result, ctx) => {
      if (!result.added) return;
      await runAutomationsForTrigger({
        accountId: ctx.accountId,
        triggerType: 'tag_added',
        contactId,
        context: { tag_id: tagId, vars: { _tag_chain_depth: 1 } },
      });
      result.dispatched = true;
    }
  );
}
export function DELETE(request: Request, { params }: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    const contactId = requireUUID((await params).id);
    const tagId = requireUUID((await readObject(request)).tag_id);
    try {
      await setContactTag(db, ctx.accountId, contactId, tagId, false);
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found'))
        throw new RequestError('Contact or tag not found.', 404);
      throw error;
    }
    return { ok: true };
  });
}
