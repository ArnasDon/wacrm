'use client';
import { createAuthClient } from 'better-auth/react';

// Same-origin cookies; no database credentials or hosted service configuration.
export const authClient = createAuthClient();
export type LocalUser = typeof authClient.$Infer.Session.user;
