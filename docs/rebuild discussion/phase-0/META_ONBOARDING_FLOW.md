# META_ONBOARDING_FLOW — In-app Meta / WhatsApp Onboarding

Every new business account completes Meta + WhatsApp Business setup **through Nexara** before messaging/campaigns unlock. Dedicated `meta-onboarding` module. Embedded Signup primary (web-first); manual credential entry = admin-assisted fallback.

## Provider separation
```
MetaBusinessProvider   → onboarding/provisioning (Embedded Signup, token exchange, phone register, webhook, WABA status)
        ↓
MetaOnboardingService  → orchestrates the state machine
        ↓
WhatsAppProvider       → ongoing messaging (send/receive/templates)  — separate
```
Do not mix onboarding responsibilities into messaging logic.

## State machine (per account)
```
created → meta_connected → phone_registered → webhook_verified → template_ready → complete
```
Failure/retry states required — a failed provider call must NOT permanently lock the account in an intermediate state (retryable + resumable).

## Guided steps
1. **Connect Meta** — Embedded Signup (Facebook Login for Business) popup → returns WABA ID + phone_number_id; exchange code for a long-lived system-user token. Fallback: manual entry (reuses existing `whatsapp_config` fields).
2. **Store identifiers** — WABA ID, phone_number_id; token server-side only (secret storage, never client-visible).
3. **Register phone** — set 2-step-verification PIN via WhatsApp `/register`.
4. **Configure webhook** — subscribe WABA to the app, set callback + verify token, confirm handshake.
5. **Sync templates** — pull existing templates; submit ≥1 approved template.
6. **Health check** — verify token validity, phone status, webhook delivery.
7. **Complete** — flip `onboarding_status = complete`; unlock messaging/broadcasts/automation.

## Gating
Operators/agents can be created pre-completion, but billable messaging features stay locked until the business admin reaches `complete`.

## Web-first, mobile bridges
Embedded Signup is browser-oriented → web is the onboarding surface. Mobile initiates/opens the secure web flow and returns via a controlled deep link (`/onboarding/complete`). Mobile is an Action Center later, not a mini-CRM (DEFERRED).

## Meta prerequisites (external, long-pole — start now)
Business Verification + App Review + Advanced Access (`whatsapp_business_messaging`, `whatsapp_business_management`) + two demo videos. Embedded Signup requires an approved app (Tech Provider). See META_COMMERCIAL_BILLING_MODEL.

## Provider methods (extend WhatsApp/Meta layer)
`exchangeToken`, `registerPhone`, `setWebhook`, `getWabaStatus`, `syncTemplates`. Server-side token refresh + invalid-token recovery.
