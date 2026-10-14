import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';

interface LocalAuthOptions {
  pool: Pool;
  secret: string;
  baseURL: string;
  sendResetEmail: (email: string, url: string) => Promise<void>;
  sendVerificationEmail?: (email: string, url: string) => Promise<void>;
}

/** The pool's search_path is identity,public. CRM accounts live in public. */
export function createLocalAuth(options: LocalAuthOptions) {
  if (options.secret.length < 32)
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
  return betterAuth({
    appName: 'WACRM',
    database: options.pool,
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: [new URL(options.baseURL).origin],
    logger: {
      // Driver errors can contain query parameters (password hashes/tokens).
      // Retain the library's event label without logging the attached objects.
      log: (level, message) => {
        if (level === 'error' || level === 'warn')
          console.error(`[auth:${level}] ${message}`);
      },
    },
    advanced: { database: { generateId: 'uuid' } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        options.sendResetEmail(user.email, url),
    },
    emailVerification: options.sendVerificationEmail
      ? {
          sendVerificationEmail: async ({ user, url }) =>
            options.sendVerificationEmail!(user.email, url),
        }
      : undefined,
    user: {
      modelName: 'users',
      changeEmail: {
        enabled: Boolean(options.sendVerificationEmail),
        updateEmailWithoutVerification: false,
        sendChangeEmailConfirmation: options.sendVerificationEmail
          ? async ({ user, url }) =>
              options.sendVerificationEmail!(user.email, url)
          : undefined,
      },
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      modelName: 'sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      expiresIn: 60 * 60 * 24 * 7,
      // Always validate the database session so logout/revocation is immediate.
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'credentials',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'verifications',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
  });
}
