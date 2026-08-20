// ============================================================
// ProductCatalogueService — the §2/§11 provider abstraction for
// WhatsApp Commerce catalogue sync (P1, Phase 8).
//
// Mirrors `WhatsAppService`/`DemoWhatsAppService`
// (`src/lib/whatsapp/service.ts`): one interface, callers depend on
// it only, never on a provider SDK or raw fetch directly. Today there
// is exactly one implementation — `StubProductCatalogueService` — and
// `resolveProductCatalogueService()` is the single chokepoint that
// would branch to a real `MetaProductCatalogueService` once this
// account actually has Meta Commerce Manager access (no such
// credential concept exists anywhere in this app yet — no Settings
// field, no encrypted column, nothing to read).
//
// Per the Phase 8 brief: "architect it properly against Meta's
// Catalog API, but stub the outbound calls... it must drop in a real
// credential later without rearchitecting." The architecture here —
// the interface, the per-product sync flow, the `whatsapp_sync_log`
// lifecycle (migration 048) — is real and complete. The actual HTTP
// call to Meta is deliberately NOT implemented against real network
// code, because it cannot be exercised or verified without a live
// Commerce Manager catalog (§2: never ship unverifiable integration
// code presented as if it works). The real call, when it's built, is:
//
//   POST https://graph.facebook.com/v21.0/{catalog_id}/items_batch
//   Authorization: Bearer <token with catalog_management scope>
//   Body: {
//     item_type: 'PRODUCT_ITEM',
//     requests: [{
//       method: 'UPDATE',   // upsert semantics — also serves CREATE
//       data: {
//         retailer_id,       // <- CatalogueItemInput.retailerId
//         name,
//         description,
//         image_url,
//         availability: 'in stock',
//         condition: 'new',
//         // WhatsApp catalogue items require a price + currency Meta
//         // will display next to the product — Rimula's products
//         // aren't sold via WhatsApp catalogue checkout in this
//         // phase (no price field on `products`, §9.1), so a real
//         // implementation needs that decided before it can send a
//         // valid item, not just a credential.
//       },
//     }],
//   }
//
// One catalog per WABA (Meta's own limit) — `catalog_id` would live
// on `whatsapp_config` (account-scoped, mirroring `phone_number_id`),
// not per-product. See docs/WHATSAPP_FEASIBILITY.md for the full
// capability writeup this is grounded in.
// ============================================================

export interface CatalogueItemInput {
  productId: string;
  /** Meta's per-item SKU key. Falls back to the product's own id when
   *  no product_code is set (product_code is optional, migration 041). */
  retailerId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
}

export interface CatalogueSyncResult {
  whatsappCatalogueId: string;
}

export interface ProductCatalogueService {
  readonly isConfigured: boolean;
  syncProduct(item: CatalogueItemInput): Promise<CatalogueSyncResult>;
  deleteProduct(whatsappCatalogueId: string): Promise<void>;
}

/**
 * Thrown by the stub for every call — there is no Meta Commerce
 * Manager catalog configured for any account in this deployment.
 * Callers (the sync API route) catch this and write it verbatim into
 * `whatsapp_sync_log.sync_error` with `sync_status = 'Sync Error'`,
 * exactly like `WhatsAppNotConfiguredError` maps onto a clear
 * caller-facing failure rather than a silent no-op or a fabricated
 * success.
 */
export class CatalogueNotConfiguredError extends Error {
  constructor(
    message = 'WhatsApp Commerce catalogue is not configured for this account. Meta Commerce Manager access has not been set up — see docs/WHATSAPP_FEASIBILITY.md.'
  ) {
    super(message);
    this.name = 'CatalogueNotConfiguredError';
  }
}

export class StubProductCatalogueService implements ProductCatalogueService {
  readonly isConfigured = false;

  async syncProduct(item: CatalogueItemInput): Promise<CatalogueSyncResult> {
    throw new CatalogueNotConfiguredError(
      `Cannot sync product "${item.name}" (${item.productId}): WhatsApp Commerce catalogue is not configured for this account. Meta Commerce Manager access has not been set up — see docs/WHATSAPP_FEASIBILITY.md.`
    );
  }

  async deleteProduct(whatsappCatalogueId: string): Promise<void> {
    throw new CatalogueNotConfiguredError(
      `Cannot delete catalogue item ${whatsappCatalogueId}: WhatsApp Commerce catalogue is not configured for this account.`
    );
  }
}

/**
 * Resolve the catalogue service for an account. Always the stub
 * today — this is the one place a future real implementation branches
 * from (same shape as `resolveWhatsAppService`'s
 * `demo_mode_enabled` / `whatsapp_config` check), once a catalog_id +
 * credential actually exist somewhere to read.
 */
export function resolveProductCatalogueService(): ProductCatalogueService {
  return new StubProductCatalogueService();
}
