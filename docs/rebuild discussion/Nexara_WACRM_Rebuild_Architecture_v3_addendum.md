# Nexara WACRM — Rebuild Architecture v3 (addendum to v2)

> Supersedes the open decisions in v2. Read v2 for the full plan; this addendum locks four items and adds the Meta onboarding requirement. Everything stays adapter-model.

---

## Decision 1 — Drop Supabase entirely

- **No Supabase** anywhere — not as the "old" store during strangler, not for auth, not for storage.
- Database resolved through the framework `DatabaseProvider`: **D1 vs Neon/Postgres decided by the v2 benchmark gate**. Business modules never import a DB SDK.
- Strangler is **by provider swap**: existing feature code keeps its behaviour, its data access is re-pointed onto the new provider. No dual Supabase↔new-DB split-brain — there is one new store; Supabase is removed as each module migrates.
- Storage → `StorageProvider`/R2. Vector → `VectorProvider`/Vectorize. (unchanged from v2)

## Decision 2 — Auth uses the framework's own `AuthProvider` (extended)

The framework already ships `core/auth/auth-provider.interface.ts`. Use it as the seam — do **not** add Auth.js or Supabase Auth. It currently exposes only `login / logout / getCurrentUser / getSession / verifyPermission`. Extend the interface to cover the plan's requirements, implemented by a `JwtAuthProvider` (jose) over new tables:

```ts
interface AuthProvider {
  // existing
  login(c: Credentials): Promise<Session>;
  logout(accessToken: string): Promise<void>;
  getCurrentUser(accessToken: string): Promise<AuthUser | null>;
  getSession(accessToken: string): Promise<Session | null>;
  verifyPermission(user: AuthUser, permission: Permission): boolean;
  // added (behind the same interface)
  refresh(refreshToken: string): Promise<Session>;          // rotating refresh
  revokeSession(sessionId: string): Promise<void>;
  revokeAllSessions(userId: UserId): Promise<void>;
  listSessions(userId: UserId): Promise<DeviceSession[]>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  verifyEmail(token: string): Promise<void>;
  acceptInvitation(token: string, password: string): Promise<Session>;
}
```

New tables (in the new DB, adapter-portable): `users`, `sessions`, `refresh_tokens` (rotation + reuse-detection → revoke family), `email_tokens` (reset + verify), `device_installations`.

- **Web:** access token in httpOnly secure cookie; refresh rotation server-side.
- **Mobile:** short-lived access + rotating refresh in OS secure storage (Keychain/Keystore via Expo SecureStore); optional biometric unlock.
- Password hashing = Workers-safe (WebCrypto PBKDF2 or WASM argon2 — no Node `bcrypt`).
- RBAC stays the framework `PermissionService`; server is final authority.

## Decision 3 — Generate a NEW repository from both

Neither existing repo is the home:
- `wacrm` = fork of a public repo (`ArnasDon/wacrm`) — carries upstream history/license.
- `nexara-repo-framework` = our private framework.

**Create a new repo** = framework core + wacrm business modules merged. Approach:
- Framework `core` (container, guards, providers, rbac, events, context) becomes the base.
- wacrm features move in as `modules/*` (conversations, contacts, messages, broadcasts, wallet, automation, whatsapp, ai, billing, branding, meta-onboarding).
- `apps/web` (Next 16 + shadcn) and `apps/mobile` (Expo) sit on top; shared `packages/*` (domain, contracts, api-client).
- Keep the framework arch guard (`check-architecture.mjs`), re-pointed at the new layout, blocking in CI.
- Preserve wacrm's MIT/upstream attribution as required by its license; port code, not fork lineage.

## Decision 4 — In-app Meta / WhatsApp onboarding (was deferred, now required)

Every new business account must complete full Meta + WhatsApp Business setup **through our app** before it can use messaging/campaigns. New **`meta-onboarding` module** + an account `onboarding_status` state machine that gates the app.

**Onboarding steps (guided wizard, web + mobile):**
1. **Connect Meta** — Embedded Signup (Facebook Login for Business) popup → returns WABA ID + phone number ID; exchange code for a long-lived system-user token. Fallback: manual credential entry (reuses existing `whatsapp_config` fields) for admin-assisted setup.
2. **Register phone number** — set 2-step-verification PIN via WhatsApp `/register`.
3. **Configure webhook** — subscribe the WABA to our app, set callback URL + verify token, confirm handshake.
4. **Sync templates** — pull existing message templates; submit at least one approved template.
5. **Health check** — verify token validity, phone status, webhook delivery.
6. **Enable campaigns** — flip `onboarding_status = complete`; broadcasts/automations unlock.

**State machine (per account):**
```
created → meta_connected → phone_registered → webhook_verified
       → template_ready → complete
```
App shows the next required step until `complete`; operators/agents can be created but messaging features stay locked until the business admin finishes onboarding.

**Backend:** extend the WhatsApp provider — `MetaWhatsAppProvider` gains `registerPhone`, `setWebhook`, `exchangeToken`, `getWabaStatus`. Secrets (system-user token) stored via secret management, never client-visible. Token refresh + invalid-token recovery handled server-side.

Ties to existing plan: provisioning memory said Meta setup was manual admin paste with Embedded Signup deferred — **v3 reverses that**: Embedded Signup is now the primary path, manual entry is the fallback.

---

## Updated Phase 0 deliverables (add to v2 §19)

- `ARCHITECTURE_GAP_REPORT.md`, `DATABASE_DECISION.md`, `MIGRATION_MAP.md` (from v2)
- **`NEW_REPO_PLAN.md`** — merge layout of framework + wacrm into the new repo, guard re-point, license/attribution handling.
- **`AUTH_EXTENSION.md`** — the extended `AuthProvider` contract + tables + rotation/reuse-detection design.
- **`META_ONBOARDING_FLOW.md`** — the step machine, Embedded Signup integration, provider methods, gating rules.

## Carry-overs still to fold in (from architect review §9)

AI spend cap + per-client rate limit + cost logging; MFA for platform-admin; audit log scoped to wallet/role/platform-admin/onboarding actions; Workers Paid cost floor + itemized D1/R2/Vectorize/Queues.
