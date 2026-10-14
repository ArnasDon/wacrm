import 'server-only';
import { getPool } from '@/lib/db/pool';
import { createLocalAuth } from './config';
import { sendAuthEmail } from './email';

let instance: ReturnType<typeof createLocalAuth> | undefined;

export function getAuth() {
  if (instance) return instance;
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || !baseURL)
    throw new Error(
      'Configure BETTER_AUTH_SECRET and BETTER_AUTH_URL in .env.local. See database/README.md.'
    );
  instance = createLocalAuth({
    pool: getPool('auth'),
    secret,
    baseURL,
    sendResetEmail: sendAuthEmail,
    sendVerificationEmail: (email, url) =>
      sendAuthEmail(email, url, { purpose: 'verify-email' }),
  });
  return instance;
}
