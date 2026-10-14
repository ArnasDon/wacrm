import {
  accountRoute,
  readObject,
  requireUUID,
  RequestError,
} from '@/lib/api/local-route';
import {
  runAutomationsForTrigger,
  type AutomationContext,
} from '@/lib/automations/engine';
import type { AutomationTriggerType } from '@/types';
export async function POST(request: Request) {
  const response = await accountRoute(
    request,
    'agent',
    async (db, ctx) => {
      const body = await readObject(request);
      if (typeof body.trigger_type !== 'string' || !body.trigger_type)
        throw new RequestError('trigger_type required');
      const contactId =
        body.contact_id == null ? null : requireUUID(body.contact_id);
      if (contactId) {
        const owned = await db.query(
          'SELECT id FROM public.contacts WHERE account_id=$1 AND id=$2',
          [ctx.accountId, contactId]
        );
        if (!owned.rows.length)
          throw new RequestError('Contact not found.', 404);
      }
      if (
        body.context !== undefined &&
        (!body.context ||
          typeof body.context !== 'object' ||
          Array.isArray(body.context))
      )
        throw new RequestError('Invalid automation context.');
      return {
        triggerType: body.trigger_type as AutomationTriggerType,
        contactId,
        context: (body.context ?? {}) as AutomationContext,
      };
    },
    async (result, ctx) => {
      await runAutomationsForTrigger({ accountId: ctx.accountId, ...result });
    }
  );
  return response.ok ? Response.json({ ok: true }) : response;
}
