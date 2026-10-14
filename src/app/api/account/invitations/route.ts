import { accountRoute, readObject, RequestError } from '@/lib/api/local-route';
import { isAccountRole } from '@/lib/auth/roles';
import { clampExpiryDays, inviteUrl } from '@/lib/auth/invitations';
import { createInvitation, listInvitations } from '@/lib/db/invitations';

export function GET(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => ({
    invitations: await listInvitations(db, ctx.accountId),
  }));
}
export function POST(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    const body = await readObject(request);
    if (!isAccountRole(body.role) || body.role === 'owner')
      throw new RequestError('Choose admin, agent, or viewer.');
    if (
      body.label !== undefined &&
      body.label !== null &&
      (typeof body.label !== 'string' || body.label.trim().length > 80)
    )
      throw new RequestError('Label must contain at most 80 characters.');
    const expiresInDays = clampExpiryDays(
      typeof body.expiresInDays === 'number' ? body.expiresInDays : undefined
    );
    const result = await createInvitation(db, ctx.userId, {
      role: body.role,
      label: typeof body.label === 'string' ? body.label : undefined,
      expiresInDays,
    });
    const origin = process.env.BETTER_AUTH_URL;
    if (!origin) throw new Error('BETTER_AUTH_URL is required.');
    return {
      ...result,
      url: inviteUrl(result.token, new URL(origin).origin),
      expiresInDays,
    };
  });
}
