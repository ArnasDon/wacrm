import {
  accountRoute,
  readObject,
  RequestError,
  requireUUID,
} from '@/lib/api/local-route';
import { isAccountRole } from '@/lib/auth/roles';
import { setMemberRole, removeMember } from '@/lib/db/accounts';

type Context = { params: Promise<{ userId: string }> };
export function PATCH(request: Request, { params }: Context) {
  return accountRoute(request, 'admin', async (db) => {
    const body = await readObject(request);
    if (!isAccountRole(body.role) || body.role === 'owner')
      throw new RequestError(
        'Choose admin, agent, or viewer. Transfer ownership separately.'
      );
    await setMemberRole(db, requireUUID((await params).userId), body.role);
    return { ok: true };
  });
}
export function DELETE(request: Request, { params }: Context) {
  return accountRoute(request, 'admin', async (db) => ({
    ok: true,
    newPersonalAccountId: await removeMember(
      db,
      requireUUID((await params).userId)
    ),
  }));
}
