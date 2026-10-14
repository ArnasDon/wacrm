import {
  requireLocalApiKey,
  withApiKeyAccount,
  apiBody,
  apiUUID,
} from '@/lib/auth/api-context-local';
import { ok, fail, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getApiContact, replaceApiTags } from '@/lib/db/public-api';
import { updateContact } from '@/lib/db/contacts';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
type Route = { params: Promise<{ id: string }> };
export async function GET(request: Request, route: Route) {
  try {
    const ctx = await requireLocalApiKey(request, 'contacts:read');
    const id = apiUUID((await route.params).id);
    const contact = await withApiKeyAccount(ctx, 'contacts:read', (db) =>
      getApiContact(db, ctx.accountId, id)
    );
    return contact ? ok(contact) : fail('not_found', 'Contact not found', 404);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
export async function PATCH(request: Request, route: Route) {
  try {
    const ctx = await requireLocalApiKey(request, 'contacts:write');
    const id = apiUUID((await route.params).id);
    const body = await apiBody(request);
    const updates: Record<string, string | null> = {};
    for (const field of ['name', 'email', 'company'] as const) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value !== null && typeof value !== 'string')
        throw badRequest(field + ' must be a string or null');
      updates[field] = value;
    }
    const result = await withApiKeyAccount(
      ctx,
      'contacts:write',
      async (db, auditUserId) => {
        if (!(await getApiContact(db, ctx.accountId, id))) return null;
        await updateContact(db, ctx.accountId, id, updates);
        const added = Array.isArray(body.tags)
          ? await replaceApiTags(
              db,
              ctx.accountId,
              auditUserId,
              id,
              body.tags.filter((tag): tag is string => typeof tag === 'string')
            )
          : [];
        return { contact: await getApiContact(db, ctx.accountId, id), added };
      }
    );
    if (!result) return fail('not_found', 'Contact not found', 404);
    for (const tagId of result.added)
      await runAutomationsForTrigger({
        accountId: ctx.accountId,
        triggerType: 'tag_added',
        contactId: id,
        context: { tag_id: tagId, vars: { _tag_chain_depth: 1 } },
      });
    return ok(result.contact);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
