# AUTH_EXTENSION — Extended Framework AuthProvider

Framework ships `core/auth/auth-provider.interface.ts` with only `login/logout/getCurrentUser/getSession/verifyPermission`. Extend the **same interface** (no Auth.js, no Supabase Auth). Implement with `JwtAuthProvider` (jose). RBAC stays framework `PermissionService`; server is final authority.

## Interface additions
```ts
interface AuthProvider {
  // existing
  login(c: Credentials): Promise<Session>;
  logout(accessToken: string): Promise<void>;
  getCurrentUser(accessToken: string): Promise<AuthUser | null>;
  getSession(accessToken: string): Promise<Session | null>;
  verifyPermission(user: AuthUser, permission: Permission): boolean;
  // added
  refresh(refreshToken: string): Promise<Session>;        // rotating; reuse → revoke family
  revokeSession(sessionId: string): Promise<void>;
  revokeAllSessions(userId: UserId): Promise<void>;
  listSessions(userId: UserId): Promise<DeviceSession[]>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  verifyEmail(token: string): Promise<void>;
  acceptInvitation(token: string, password: string): Promise<Session>;
}
```

## Tables (adapter-portable; D1 or Neon)
- `users` — id, account_id, email(unique), password_hash, email_verified_at, role, timestamps.
- `sessions` — id, user_id, device_id, created_at, last_seen_at, expires_at, revoked_at.
- `refresh_tokens` — id, session_id, token_hash, family_id, rotated_from, expires_at, used_at, revoked_at. **Reuse detection:** a used/rotated token presented again → revoke the whole `family_id`.
- `email_tokens` — id, user_id, type(reset|verify|invite), token_hash, expires_at, consumed_at.
- `device_installations` — id, user_id, account_id, platform, push_token, device_id, app_version, last_seen_at, enabled.

## Rules
- **Web:** access token in httpOnly Secure SameSite cookie; refresh rotation server-side; CSRF protection on state-changing routes.
- **Mobile:** short-lived access + rotating refresh in OS secure storage (Expo SecureStore → Keychain/Keystore); optional biometric unlock.
- **Hashing:** Workers-safe only — WebCrypto PBKDF2 (high iteration) or WASM argon2id. **No Node `bcrypt`.**
- Store only token **hashes**, never raw tokens. Reset/verify/invite tokens single-use + TTL.
- Rate-limit login / refresh / reset endpoints.
- Tenant claim (`account_id`) + role in the access token; every request resolves `RequestContext` once at the edge.
