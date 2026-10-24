#!/usr/bin/env node
/**
 * Generates a consistent set of secrets for a fresh Supabase self-hosted stack.
 * Usage: node scripts/supabase-keys.mjs >> .env
 *
 * Outputs five lines (KEY=value) to stdout:
 *   POSTGRES_PASSWORD  — 32 random hex bytes
 *   JWT_SECRET         — 64 random hex bytes (HMAC key for all JWTs)
 *   ANON_KEY           — HS256 JWT signed with JWT_SECRET, role: anon
 *   SERVICE_ROLE_KEY   — HS256 JWT signed with JWT_SECRET, role: service_role
 *   ENCRYPTION_KEY     — 32 random bytes as 64 hex chars (AES-256-GCM key for token encryption)
 *   REALTIME_ENC_KEY   — 16 hex chars (16 raw bytes → AES-128-ECB key for Realtime seeds)
 *
 * No dependencies — pure Node.js crypto.
 */

import { createHmac, randomBytes } from 'node:crypto';

function hex(bytes) {
  return randomBytes(bytes).toString('hex');
}

function base64url(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return Buffer.from(str).toString('base64url');
}

function mintJwt(role, jwtSecret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    role,
    iss: 'supabase',
    iat,
    exp: iat + 315360000, // 10 years, matching Supabase self-hosting defaults
  };
  const unsigned = `${base64url(header)}.${base64url(payload)}`;
  const sig = createHmac('sha256', jwtSecret)
    .update(unsigned)
    .digest('base64url');
  return `${unsigned}.${sig}`;
}

const postgresPassword = hex(32);
const jwtSecret = hex(64);
const anonKey = mintJwt('anon', jwtSecret);
const serviceRoleKey = mintJwt('service_role', jwtSecret);
const encryptionKey = hex(32); // 32 bytes = 64 hex chars (AES-256)
const cronSecret = hex(32);
const realtimeEncKey = randomBytes(8).toString('hex'); // 16 chars = 16 bytes raw → AES-128-ECB

process.stdout.write(
  [
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `JWT_SECRET=${jwtSecret}`,
    `ANON_KEY=${anonKey}`,
    `SERVICE_ROLE_KEY=${serviceRoleKey}`,
    `ENCRYPTION_KEY=${encryptionKey}`,
    `REALTIME_ENC_KEY=${realtimeEncKey}`,
    `AUTOMATION_CRON_SECRET=${cronSecret}`,
  ].join('\n') + '\n'
);
