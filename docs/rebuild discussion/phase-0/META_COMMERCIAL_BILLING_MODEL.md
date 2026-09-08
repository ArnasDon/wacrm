# Phase 0B — Meta Commercial Billing Eligibility

Research 2026-09-09 against Meta's official WhatsApp Business Platform docs. Question: can Nexara operate as a Solution Partner with a credit-line, receiving Meta's aggregated invoice and settling charges for customer WABAs?

## Two Meta partner types

| | **Tech Provider** | **Solution Partner** (formerly BSP) |
|---|---|---|
| Credit line with Meta | **No** | **Yes** — extends to onboarded clients |
| Who Meta bills for message usage | **The customer's own WABA** (customer adds their own credit card) | **The partner** (partner settles Meta, invoices clients) |
| Client invoicing | Partner bills only for its own services | Partner directly invoices clients for WhatsApp usage |
| How to obtain | Business Verification + App Review + Advanced Access + Embedded Signup + Webhooks. **No volume/financial minimum.** Weeks. | "**A lengthy process**" per Meta. No public self-serve, no published requirements, tiered (Select/Premier). Application + qualification gated. Not guaranteed. |
| Enables the preferred model? | No | **Yes** |

## Answers to v6 §3 required questions

1. **Solution Partner eligibility** — application/qualification-gated, "lengthy", not open self-serve, no published minimums. Assume slow + uncertain.
2. **Credit-line availability** — Solution Partner only. Tech Providers have none.
3. **Embedded Signup** — available to Tech Providers (required to onboard). Confirmed usable in the fallback model.
4. **Business Verification** — required for both (Meta Business verification before App Review).
5. **App Review / Advanced Access** — required: `whatsapp_business_messaging` (send on behalf of clients) + `whatsapp_business_management` (access client WABAs). Two demo videos (send message, create template).
6. **Aggregated invoice / settle on behalf of customer WABAs** — **only as a Solution Partner.** As a Tech Provider, **Meta bills the customer's WABA directly** — Nexara cannot settle Meta charges.
7. **Zero-credit behavior** — see CREDITS_BILLING_DESIGN (block/pause billable sends).
8. **Auto-suspend messaging** — enforceable in our app (gate the send path) in both models.
9. **Refunds/chargebacks** — our PaymentProvider layer; Meta charges (fallback) are the customer's own concern.

## Decision — build fallback now, pursue preferred in parallel

- **V1 = Tech Provider fallback model.** Achievable in weeks. Meta bills the customer's own WABA payment method for WhatsApp usage. **Nexara Credits are prepaid access-control + Nexara's service margin**, metered in our app, reconciled against Meta usage reports (read via API) for accuracy — NOT for paying Meta.
  ```
  Customer → Meta        (WhatsApp usage, customer WABA billed directly)
  Customer → Nexara      (prepaid credits: access + service fee/margin)
  ```
- **Business track (parallel, not blocking build):** apply for Solution Partner. If granted, flip to preferred model:
  ```
  Customer → Nexara Prepaid Credits → WhatsApp → Meta   (Nexara settles Meta)
  ```
- **Swappable at billing layer only** (v6 addition #2): the credit wallet, usage metering, reserve/settle lifecycle, and onboarding/messaging are identical in both. Only "who settles Meta" differs — a strategy behind the billing/commercial boundary. **The WhatsApp/messaging architecture never changes.**

## Consequence for the reservation lifecycle
In the fallback, `reserve → settle` meters **Nexara's** access/margin billing and gates the send button; it does **not** settle Meta. Reconciliation reads Meta usage (via WABA analytics/usage API) to keep our metering honest. In the preferred model, the same lifecycle additionally settles Meta from the credit line. Design the meter provider-neutral so the settlement target is swappable.

## Immediate external actions (long-pole)
- Start **Meta Business Verification** now (needed for BOTH models).
- Prepare **App Review** (privacy policy, app category, two demo videos, Advanced Access justification).
- Open the **Solution Partner** application track separately.
