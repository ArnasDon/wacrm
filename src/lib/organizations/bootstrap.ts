// ============================================================
// Shared "turn this account into a store" sequence — rename the
// account, create its organization, link the two. Used by both
// POST /api/platform/organizations (platform admin creating a store
// on a customer's behalf) and POST /api/auth/store-signup (a store
// owner signing themselves up) — the only difference between those
// two callers is HOW the account got created (invite vs public
// signup) and how they're authorized to call this; the bootstrap
// itself is identical.
//
// Always takes an admin (service-role) client — both call sites run
// before/without a normal RLS-scoped session for this account.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export type BootstrapStage = "rename" | "create" | "link";

export class BootstrapOrganizationError extends Error {
  readonly stage: BootstrapStage;
  constructor(stage: BootstrapStage, cause?: unknown) {
    super(`bootstrapStoreOrganization failed at stage "${stage}"`);
    this.name = "BootstrapOrganizationError";
    this.stage = stage;
    this.cause = cause;
  }
}

export interface BootstrappedOrganization {
  id: string;
  name: string;
  status: string;
  billing_status: string;
  created_at: string;
}

/**
 * Renames `accountId` to `storeName`, creates its organization, and
 * links the two. Throws `BootstrapOrganizationError` (with a `stage`
 * telling the caller which step failed) on any error — callers map
 * that to their own context-appropriate message.
 */
export async function bootstrapStoreOrganization(
  admin: AdminClient,
  accountId: string,
  storeName: string,
): Promise<BootstrappedOrganization> {
  const { data: account, error: accountError } = await admin
    .from("accounts")
    .update({ name: storeName })
    .eq("id", accountId)
    .select("id, name")
    .single();

  if (accountError || !account) {
    throw new BootstrapOrganizationError("rename", accountError);
  }

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: storeName, owner_account_id: account.id })
    .select("id, name, created_at, status, billing_status")
    .single();

  if (orgError || !org) {
    throw new BootstrapOrganizationError("create", orgError);
  }

  const { error: linkError } = await admin
    .from("accounts")
    .update({ organization_id: org.id })
    .eq("id", account.id);

  if (linkError) {
    throw new BootstrapOrganizationError("link", linkError);
  }

  return org;
}
