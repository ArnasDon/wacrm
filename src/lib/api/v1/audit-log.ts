// ============================================================
// Lightweight request log for /api/v1/* (security audit finding
// API-N2 — "API Pública v1"). Written by `withApiKey()`
// (src/lib/auth/api-context.ts), the single choke point every one of
// the 11 public-API routes already goes through, so this covers all
// of them uniformly without any per-route logging code.
//
// Deliberately minimal: account_id, key_id, method, path, status,
// created_at. NEVER the Authorization header, the API key itself, a
// request body, a response body, or any message/contact content —
// there is no code path here that could even read those.
//
// Best-effort: a failed write must never fail the API response the
// caller is actually waiting on.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';

export interface ApiRequestLogEntry {
  /** null when auth itself failed — no account was ever resolved. */
  accountId: string | null;
  /** null when auth itself failed. */
  keyId: string | null;
  method: string;
  path: string;
  status: number;
}

/** Fire-and-forget — callers should not `await` this on the response path. */
export function logApiRequest(entry: ApiRequestLogEntry): void {
  void supabaseAdmin()
    .from('api_request_log')
    .insert({
      account_id: entry.accountId,
      key_id: entry.keyId,
      method: entry.method,
      path: entry.path,
      status: entry.status,
    })
    .then(({ error }) => {
      if (error) {
        console.warn('[api/v1] audit log write failed:', error.message);
      }
    });
}
