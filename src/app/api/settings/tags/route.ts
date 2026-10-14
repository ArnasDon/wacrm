import {
  accountRoute,
  readObject,
  RequestError,
  requireUUID,
} from '@/lib/api/local-route';
import { listTags, createTag, deleteTag } from '@/lib/db/tags';

export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    tags: await listTags(db, ctx.accountId),
  }));
}
export function POST(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    const body = await readObject(request);
    if (
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      body.name.trim().length > 40
    )
      throw new RequestError('Tag name must contain 1–40 characters.');
    if (typeof body.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(body.color))
      throw new RequestError('Invalid tag color.');
    return {
      tag: await createTag(db, ctx.userId, body.name.trim(), body.color),
    };
  });
}
export function DELETE(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    if (
      !(await deleteTag(
        db,
        ctx.accountId,
        requireUUID((await readObject(request)).id)
      ))
    )
      throw new RequestError('Tag not found.', 404);
    return { ok: true };
  });
}
