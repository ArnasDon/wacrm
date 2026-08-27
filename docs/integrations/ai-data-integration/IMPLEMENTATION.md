# AI Data Sources + Catalog Integrations — implementation notes

> Companion to `01_MASTER_EXECUTION.md` / `02_SCOPE_AND_GUARDRAILS.md` /
> `03_AGENT_PROMPT_RULES.md` / `04_EXECUTION_CHECKLIST.md` in this same
> folder, and to `docs/integrations/budun-erp/WACRM_ERP_CATALOG_
> INTEGRATION_SPEC_v4.md` / `WACRM_IMPLEMENTATION_PROMPT_v4.md`. This
> file documents what was actually built, not the spec.

## 1. Agent message flow (as implemented)

```
Cliente WhatsApp
  → webhook (src/app/api/whatsapp/webhook)
  → dispatchInboundToAiReply()            src/lib/ai/auto-reply.ts
      → loadAiConfig()                    src/lib/ai/config.ts        (unchanged)
      → buildConversationContext()        src/lib/ai/context.ts       (unchanged)
      → retrieveKnowledge()               src/lib/ai/knowledge.ts     (unchanged)
      → hasActiveCatalogSources()         src/lib/ai/catalog/resolver.ts   (NEW)
      → buildSystemPrompt(..., catalogToolsAvailable)  src/lib/ai/defaults.ts (extended)
      → generateReply({ tools, executeTool })          src/lib/ai/generate.ts (extended)
          → provider adapter runs its OWN bounded tool loop:
              model → tool_calls → executeTool() → tool_result → model → final text
          → executeTool = wrapWithMediaSideEffect(executeCatalogTool(db, accountId), …)
              → executeCatalogTool          src/lib/ai/tools/catalog-tools.ts (NEW)
                  → resolver.searchCatalog/getProduct/getAvailability/getProductMedia
                      → CatalogProvider (BudunProvider | DataSourceCatalogProvider)
                      → whitelist.toCatalogProduct / toToolResultProduct (NEW)
              → on a successful get_product_media: engineSendMedia()   (existing, reused)
      → engineSendText()                  src/lib/flows/meta-send.ts  (existing, reused)
  → WhatsApp
```

The exact same pipeline (minus the WhatsApp send) runs from
`/api/ai/playground` so an admin can verify product/price/color/
variant/stock/photo answers before turning auto-reply on.

**Accounts with nothing configured see byte-for-byte the same request
as before this feature existed** — `hasActiveCatalogSources()` returns
`false`, so `tools`/`executeTool` are `undefined` and neither provider
adapter puts a `tools` field on the wire.

## 2. Why the model can't invent a price (code-level, not just prompt)

1. Catalog-usage Data Sources are **never** written to
   `ai_knowledge_documents`/`ai_knowledge_chunks` — `usage: catalog`
   only populates `ai_catalog_products`, which is reachable exclusively
   through `search_catalog`/`get_product`/`get_availability`/
   `get_product_media`. There is no path for a catalog price to appear
   in the prompt text at all.
2. `get_product`/`get_availability`/`get_product_media` take an `id`
   that must have come from a prior `search_catalog`/`get_product`
   call — it's a composite `<providerKey>_<nativeId>` (`src/lib/ai/
   catalog/id.ts`). A fabricated id either fails to decode or decodes
   to a provider key that isn't in the account's currently-active
   provider list, and the tool returns `{error: "not_found"}` —
   never a guessed value.
3. Every provider (`BudunProvider`, `DataSourceCatalogProvider`) must
   return data through `toCatalogProduct()` (`src/lib/ai/catalog/
   whitelist.ts`), a strict allow-list. Forbidden fields (IMEI, serial,
   cost, margin, supplier, …) have no path onto the object because the
   mapping function never reads them — see `whitelist.test.ts`.
4. The tool executor never forwards a raw provider/ERP error message to
   the model — infrastructure failures collapse to
   `{error: "catalog_unavailable"}`.
5. `buildSystemPrompt()` additionally instructs the model to use the
   tools and never invent — belt-and-suspenders, not the primary
   mechanism.

## 3. Data Sources vs. Catalog Integrations vs. Knowledge Base

| | Knowledge Base (existing) | Data Sources (NEW) | Catalog Integrations (NEW) |
|---|---|---|---|
| UI | AI Agents → Knowledge Base | Settings → Data sources | Settings → Integrations |
| Content | manual + legacy singleton `type='inventory'` upload | google_sheets / remote_csv / uploaded_csv, multiple, each with `usage: knowledge\|catalog\|both` | Budun ERP (Catalog API) |
| Reaches the model via | `retrieveKnowledge()` → prompt text | `usage=knowledge/both` → same KB path (`type='data_source'`) | tool calls only |
| `usage=catalog/both` rows | — | `ai_catalog_products`, tool calls only | tool calls only |

A Data Source can be **knowledge-only** (store hours, promotions, FAQ
in a Sheet — same trust level as the existing KB), **catalog-only**
(a product CSV, queried only via tools), or **both**. The legacy
`/api/ai/knowledge/{upload,sheet}` singleton-inventory routes are
**untouched** — this feature is fully additive alongside them.

## 4. Integration Resolver + fallback policy

`src/lib/ai/catalog/resolver.ts` merges active `catalog_integrations`
(Budun) and active catalog/both `ai_data_sources` for the account,
ordered primary-first then by `priority`. `searchCatalog()` walks that
list applying each provider's own `fallback_policy`:

- `primary_only` — never falls through, found or not.
- `fallback_on_not_found` (default) — stops at the first provider that
  returns something.
- `search_all_active` — always continues, merging every active
  source's results (each result keeps its own provider-scoped id, so
  nothing gets merged INTO a single product — see "no mixing" below).

`getProduct`/`getAvailability`/`getProductMedia` decode the id's
provider prefix and route directly to that one provider — they never
re-run fallback logic, which is what makes "never mix sources" hold
structurally per `resolver.test.ts`.

## 5. account_id / tenant isolation

`accountId` is always a plain function argument supplied by the caller
(`dispatchInboundToAiReply`'s `args.accountId`, itself from the
authenticated webhook/session — unchanged from before this feature).
Nothing under `src/lib/ai/catalog/` or `src/lib/ai/tools/catalog-
tools.ts` reads an account/tenant id out of tool-call `input` — see the
"ignores an account_id the caller tries to smuggle through tool input"
test in `catalog-tools.test.ts`.

## 6. Secrets

`catalog_integrations.encrypted_secret` reuses `src/lib/whatsapp/
encryption.ts`'s `encrypt()`/`decrypt()` (AES-256-GCM, `ENCRYPTION_KEY`)
— the same mechanism as `whatsapp_config.access_token` / `ai_configs.
api_key` / `webhook_endpoints.secret`. No new crypto. The secret is
never returned by any GET/list route (`PUBLIC_COLUMNS` excludes it) and
never reaches the LLM — the tool executor only ever returns whitelisted
`CatalogProduct` data, never provider credentials.

## 7. Media / WhatsApp

`get_product_media` resolves whitelisted `primaryImage`/`images` URLs;
in the real auto-reply path (never in Playground) `wrapWithMediaSide
Effect` (`src/lib/ai/auto-reply.ts`) sends the primary image via the
**existing** `engineSendMedia()` (`src/lib/flows/meta-send.ts`) — no
second media pipeline was created. A failed send is logged and
swallowed; the text reply still goes out.

## 8. Settings

- **Settings → Data sources** (`src/components/settings/data-sources-
  settings.tsx`) — CRUD for google_sheets/remote_csv/uploaded_csv,
  usage/priority/is_primary/fallback_policy, refresh, enable/disable.
- **Settings → Integrations** (`src/components/settings/catalog-
  integrations-settings.tsx`) — Budun ERP / Inventory API: base URL,
  Application ID/App Key, Application Secret (write-only, rotate by
  re-entering), fixed read-only scopes, Test Connection,
  enable/disable, remove.

Both are plain (no `next-intl` wiring) — see §10 below.

## 9. Files

See the implementation report delivered in the same turn as this
document for the full modified/created file list, migration, tests,
and build/typecheck/lint results.

## 10. Known follow-ups / risks (not blocking, not silently ignored)

1. **Budun Catalog API wire contract is unconfirmed.** The spec itself
   says to verify real routes/params before hardcoding
   (`WACRM_ERP_CATALOG_INTEGRATION_SPEC_v4.md` §5). `src/lib/budun/
   client.ts` implements the spec's best-effort shape
   (`/api/v1/catalog/{search,products}/…`, `q`/`color`/`product_id`
   query params) with unit tests against that assumed shape — it has
   **not** been exercised against a real Budun instance. Expect to
   adjust query-param names in that one file once real credentials are
   available.
2. **Migration 044 has not been applied to any database.** No local
   Supabase/Docker instance was available in this environment, and
   applying it to the linked remote project was not done without
   explicit authorization. Run `supabase db push --dry-run` (or the
   project's normal migration flow) in a dev/staging environment before
   relying on this in production.
3. **No i18n for the two new settings panels.** They use plain English
   strings rather than `next-intl` keys, unlike the rest of Settings
   (which is wired for en/es/ko). Follow-up: add `messages/*.json`
   entries and swap in `useTranslations`.
4. **`get_availability`'s per-variant breakdown from Budun is
   best-effort.** The spec doesn't give an exact shape for
   variant-level availability; `BudunProvider.getAvailability` maps a
   `variants[]` array defensively but this is unverified against a
   real payload.
5. **Provider abstraction is intentionally not user-extensible beyond
   Budun in this execution** — `catalog_integrations.provider` has a
   `CHECK (provider IN ('budun'))` constraint, per the explicit scope
   ("No implementar otros ERP funcionales" / "No implementar otro
   provider funcional aparte de Budun"). Adding a second ERP later
   means widening that constraint + a new `CatalogProvider`
   implementation — the resolver/tools/whitelist need no changes.
