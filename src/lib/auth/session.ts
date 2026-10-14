import 'server-only';
import { headers } from 'next/headers';
import { getAuth } from './server';

export class SessionRequiredError extends Error {
  readonly status = 401;
  constructor() {
    super('Unauthorized');
    this.name = 'SessionRequiredError';
  }
}

export async function requireSession(requestHeaders?: Headers) {
  const session = await getAuth().api.getSession({
    headers: requestHeaders ?? (await headers()),
  });
  if (!session) throw new SessionRequiredError();
  return session.user;
}
