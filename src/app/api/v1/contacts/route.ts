import {
  requireLocalApiKey,
  withApiKeyAccount,
  apiBody,
  apiUUID,
} from '@/lib/auth/api-context-local';
import {
  ok,
  okList,
  badRequest,
  toApiErrorResponse,
} from '@/lib/api/v1/respond';
import { parseListParams, buildPage } from '@/lib/api/v1/pagination';
import {
  listApiContacts,
  findOrCreateApiContact,
  getApiContact,
  replaceApiTags,
} from '@/lib/db/public-api';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
export async function GET(request: Request) {
  try {
    const ctx = await requireLocalApiKey(request, 'contacts:read');
    const options = parseListParams(request);
    const url = new URL(request.url);
    const tag = url.searchParams.get('tag');
    if (tag) apiUUID(tag, 'tag');
    const rows = await withApiKeyAccount(ctx, 'contacts:read', (db) =>
      listApiContacts(db, ctx.accountId, {
        ...options,
        search: url.searchParams.get('search') ?? '',
        tag,
      })
    );
    const page = buildPage(rows, options.limit);
    return okList(page.items, page.nextCursor);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await requireLocalApiKey(request, 'contacts:write');
    const body = await apiBody(request);
    if (typeof body.phone !== 'string' || !body.phone.trim())
      throw badRequest("'phone' is required");
    const result = await withApiKeyAccount(
      ctx,
      'contacts:write',
      async (db, auditUserId) => {
        const saved = await findOrCreateApiContact(
          db,
          ctx.accountId,
          auditUserId,
          {
            phone: body.phone as string,
            name: typeof body.name === 'string' ? body.name : undefined,
            email: typeof body.email === 'string' ? body.email : undefined,
            company:
              typeof body.company === 'string' ? body.company : undefined,
          }
        );
        const added = Array.isArray(body.tags)
          ? await replaceApiTags(
              db,
              ctx.accountId,
              auditUserId,
              saved.id,
              body.tags.filter((tag): tag is string => typeof tag === 'string')
            )
          : [];
        return {
          ...saved,
          added,
          contact: await getApiContact(db, ctx.accountId, saved.id),
        };
      }
    );
    for (const tagId of result.added)
      await runAutomationsForTrigger({
        accountId: ctx.accountId,
        triggerType: 'tag_added',
        contactId: result.id,
        context: { tag_id: tagId, vars: { _tag_chain_depth: 1 } },
      });
    return ok(result.contact, result.created ? 201 : 200);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
