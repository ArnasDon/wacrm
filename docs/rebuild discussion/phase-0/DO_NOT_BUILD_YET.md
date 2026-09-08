# DO_NOT_BUILD_YET — Deferred + Gated

Build only the first vertical slice (ARCHITECTURE_MODEL §5). Everything below is explicitly out.

## Gated — do NOT write until the gate passes
| Item | Gate |
|---|---|
| `credit_ledger`, reservation/settlement code | **BOTH** Meta commercial gate + DB benchmark |
| Meta charge settlement (Nexara → Meta) | Solution Partner + credit-line approved |
| DB lock (D1 or Neon) | DB correctness benchmark passed |

## Deferred — future Nexara OS, not this release
- Nexara OS Work Hub, Work Items, Activities
- Calendar
- Approvals
- Files-as-platform
- **Mobile Action Center** (mobile app itself comes after core API/domain boundaries stable; onboarding stays web-first)
- Generic multi-provider credit marketplace (AI models, voice, transcription, image gen, other comms)
- AI spend caps / full AI billing subsystem (AI is bring-your-own-key today; revisit when AI is metered)
- **Postpaid billing** (design schema to allow; do not implement — enterprise-only later: approval + credit limit + terms + spend controls + auto-suspend)
- WebSocket/Durable-Object realtime (V1 = polling + push + incremental sync; add only if UX/scale proves needed)
- Full offline-first mobile / local SQLite (V1 = persistent cache via TanStack Query)

## Complexity gate (every capability)
```
USE   already in Nexara framework
ADAPT exists in wacrm, needs framework integration
BUILD genuinely missing + required for the vertical slice
DEFER future; do not build now
```
Before building infra: can Nexara / Cloudflare / Expo / an existing library / a provider already do it? Only then build custom.

## Carry-over security (apply during build, not deferred)
platform-admin MFA · audit log (billing/role/onboarding/wallet actions) · tenant isolation · usage idempotency · rate limits (auth/AI/forms) · webhook signature verification · retry-safe provider ops · secret storage · Workers Paid cost floor + itemized D1/R2/Vectorize/Queues.
