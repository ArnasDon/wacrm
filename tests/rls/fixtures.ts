// ============================================================
// RLS test suite — two-tenant fixture (seed + cleanup).
//
// Creates two COMPLETELY independent tenants ("A" and "B") against the
// LOCAL Supabase stack only (env-guard.ts enforces this on import),
// each with one real Supabase Auth user, one real `accounts` row
// (created automatically by the existing `on_auth_user_created`
// trigger — migration 017 — never inserted by hand here), and one row
// in every resource this suite covers: catalog (data source + one
// product), Knowledge Base (one document + one chunk, with a real
// embedding so the semantic RPC has something to filter), Business
// Profile (+ one department, one contact), `ai_configs`, and one CRM
// contact + one `conversations` row carrying a distinctive
// `ai_catalog_context`.
//
// Every piece of seeded text is prefixed with an unmistakable marker
// ("RLS-FIXTURE-A-..." / "RLS-FIXTURE-B-...") specifically so that if
// a leak DOES occur, the assertion failure is unambiguous — never a
// coincidental string collision.
//
// ONLY `serviceRoleClient()` is used in this file (fixture prep is the
// one place service_role is allowed per this suite's rules) — no
// assertion of RLS behaviour happens here; that lives entirely in the
// `*.rls.test.ts` files, which use `signInAsFixtureUser()` instead.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { serviceRoleClient } from './clients'

export interface FixtureAccount {
  label: 'A' | 'B'
  email: string
  password: string
  userId: string
  accountId: string
  dataSourceId: string
  productId: string
  productSourceProductId: string
  knowledgeDocumentId: string
  knowledgeChunkId: string
  businessProfileId: string
  departmentId: string
  contactId: string
  aiConfigId: string
  crmContactId: string
  conversationId: string
}

export interface RlsFixtures {
  a: FixtureAccount
  b: FixtureAccount
}

const PASSWORD = 'Rls-Fixture-Password-1!'
const EMAIL_A = 'rls-fixture-a@wacrm.local'
const EMAIL_B = 'rls-fixture-b@wacrm.local'

/** `toVectorLiteral` from src/lib/ai/embeddings.ts, reproduced locally
 *  so this suite has zero import dependency on `src/` — this is
 *  exactly the format the real ingest path already writes
 *  (`embedding: toVectorLiteral(embeddings[i])`), confirmed by reading
 *  that file; not a guess. */
function vectorLiteral(fill: number, dims = 1536): string {
  return `[${Array(dims).fill(fill).join(',')}]`
}

/**
 * Removes a previous run's leftover fixture user (and everything that
 * cascades from their `accounts` row), keyed by email — makes seeding
 * idempotent across repeated local `npm run test:rls` runs without
 * requiring a `supabase db reset` each time. In CI, where every run
 * starts from a freshly reset database, this is normally a no-op.
 *
 * Order matters: `accounts.owner_user_id` is `ON DELETE RESTRICT`
 * against `auth.users`, so the account (and everything that cascades
 * from it) must be deleted BEFORE the auth user itself.
 */
async function deleteFixtureIfExists(db: SupabaseClient, email: string): Promise<void> {
  // Local test DB only — a handful of fixture users at most, so one
  // page is always enough. Not a general-purpose user lookup.
  const { data: list, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listErr) throw new Error(`[rls-fixtures] listUsers failed: ${listErr.message}`)
  const existing = list.users.find((u) => u.email === email)
  if (!existing) return

  // Cascades away profiles/data sources/products/knowledge/business
  // profile/ai_configs/conversations for this account (see the FK
  // ON DELETE CASCADE chains documented in supabase/migrations —
  // 017/029/030/044/045/050 all reference accounts(id) ON DELETE
  // CASCADE).
  const { error: acctErr } = await db.from('accounts').delete().eq('owner_user_id', existing.id)
  if (acctErr) throw new Error(`[rls-fixtures] cleanup: deleting account failed: ${acctErr.message}`)

  // `contacts` (the CRM table) IS account-scoped since migration 017
  // (its RLS was rewritten to `is_account_member(account_id)`, same as
  // every other domain table) — but it has no FK back to `accounts`
  // that cascades from deleting the account's OWNER (only from
  // deleting the account row itself, which the delete above already
  // did, cascading this table's account_id too). This second delete,
  // keyed by user_id, only matters for a fixture that failed BEFORE
  // the accounts row was ever created (e.g. createUser succeeded but
  // handle_new_user's own try/catch swallowed an error) — otherwise
  // it is a no-op by the time it runs.
  const { error: contactsErr } = await db.from('contacts').delete().eq('user_id', existing.id)
  if (contactsErr) throw new Error(`[rls-fixtures] cleanup: deleting contacts failed: ${contactsErr.message}`)

  const { error: userErr } = await db.auth.admin.deleteUser(existing.id)
  if (userErr) throw new Error(`[rls-fixtures] cleanup: deleteUser failed: ${userErr.message}`)
}

async function seedOneAccount(db: SupabaseClient, label: 'A' | 'B'): Promise<FixtureAccount> {
  const email = label === 'A' ? EMAIL_A : EMAIL_B
  const marker = `RLS-FIXTURE-${label}`

  await deleteFixtureIfExists(db, email)

  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `${marker} Owner` },
  })
  if (createErr || !created.user) {
    throw new Error(`[rls-fixtures] createUser(${email}) failed: ${createErr?.message ?? 'no user returned'}`)
  }
  const userId = created.user.id

  // `handle_new_user` (migration 017) fires synchronously, in the same
  // transaction as the auth.users INSERT above, and creates exactly
  // one accounts row (owner_user_id = userId) + one profiles row
  // (account_role = 'owner') — never inserted by hand here.
  const { data: profile, error: profileErr } = await db
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .single()
  if (profileErr || !profile?.account_id) {
    throw new Error(
      `[rls-fixtures] expected on_auth_user_created to have created a profile for ${email}, ` +
        `but none was found: ${profileErr?.message ?? 'no row'}. Is migration 017 applied?`,
    )
  }
  const accountId = profile.account_id as string

  // ---- Catalog: one active data source + one product ----
  const { data: dataSource, error: dsErr } = await db
    .from('ai_data_sources')
    .insert({
      account_id: accountId,
      created_by: userId,
      source_type: 'uploaded_csv',
      display_name: `${marker} Catalog`,
      usage: 'catalog',
      status: 'active',
      is_primary: true,
    })
    .select('id')
    .single()
  if (dsErr || !dataSource) throw new Error(`[rls-fixtures] ai_data_sources insert failed (${label}): ${dsErr?.message}`)

  const productSourceProductId = `${marker}-SKU`
  const { data: product, error: productErr } = await db
    .from('ai_catalog_products')
    .insert({
      account_id: accountId,
      data_source_id: dataSource.id,
      source_product_id: productSourceProductId,
      sku: productSourceProductId,
      name: `${marker} Secret Product`,
      brand: marker,
      price: label === 'A' ? 11111 : 22222,
      currency: 'DOP',
      available: true,
      available_quantity: 7,
    })
    .select('id')
    .single()
  if (productErr || !product) {
    throw new Error(`[rls-fixtures] ai_catalog_products insert failed (${label}): ${productErr?.message}`)
  }

  // ---- Knowledge Base: one document + one chunk (with embedding) ----
  const { data: kbDoc, error: kbDocErr } = await db
    .from('ai_knowledge_documents')
    .insert({
      account_id: accountId,
      created_by: userId,
      title: `${marker} Knowledge Document`,
      content: `${marker} confidential policy text.`,
    })
    .select('id')
    .single()
  if (kbDocErr || !kbDoc) throw new Error(`[rls-fixtures] ai_knowledge_documents insert failed (${label}): ${kbDocErr?.message}`)

  const { data: kbChunk, error: kbChunkErr } = await db
    .from('ai_knowledge_chunks')
    .insert({
      document_id: kbDoc.id,
      account_id: accountId,
      chunk_index: 0,
      content: `${marker} secret warranty terms — never shared across accounts.`,
      // Fixed, deterministic embedding — distinguishable only by which
      // account it belongs to (RLS/account_id scoping), never by
      // semantic content; this suite tests access control, not
      // retrieval quality.
      embedding: vectorLiteral(label === 'A' ? 0.001 : 0.002),
    })
    .select('id')
    .single()
  if (kbChunkErr || !kbChunk) {
    throw new Error(`[rls-fixtures] ai_knowledge_chunks insert failed (${label}): ${kbChunkErr?.message}`)
  }

  // ---- Business Profile (+ one department, one contact) ----
  const { data: bizProfile, error: bizErr } = await db
    .from('account_business_profiles')
    .insert({
      account_id: accountId,
      created_by: userId,
      business_name: `${marker} Business`,
      description: `${marker} confidential business description.`,
    })
    .select('id')
    .single()
  if (bizErr || !bizProfile) throw new Error(`[rls-fixtures] account_business_profiles insert failed (${label}): ${bizErr?.message}`)

  const { data: department, error: deptErr } = await db
    .from('account_business_departments')
    .insert({ account_id: accountId, name: `${marker} Department` })
    .select('id')
    .single()
  if (deptErr || !department) throw new Error(`[rls-fixtures] account_business_departments insert failed (${label}): ${deptErr?.message}`)

  const { data: bizContact, error: bizContactErr } = await db
    .from('account_business_contacts')
    .insert({
      account_id: accountId,
      department_id: department.id,
      name: `${marker} Contact Person`,
      phone: label === 'A' ? '+1-000-0001' : '+1-000-0002',
    })
    .select('id')
    .single()
  if (bizContactErr || !bizContact) {
    throw new Error(`[rls-fixtures] account_business_contacts insert failed (${label}): ${bizContactErr?.message}`)
  }

  // ---- ai_configs ----
  const { data: aiConfig, error: aiConfigErr } = await db
    .from('ai_configs')
    .insert({
      account_id: accountId,
      created_by: userId,
      provider: 'openai',
      model: 'gpt-test',
      // Not a real encrypted blob — this suite never decrypts it, only
      // tests whether a DIFFERENT account can read/write this row.
      api_key: `${marker}-fake-encrypted-key`,
      system_prompt: `${marker} confidential system prompt — never shared across accounts.`,
    })
    .select('id')
    .single()
  if (aiConfigErr || !aiConfig) throw new Error(`[rls-fixtures] ai_configs insert failed (${label}): ${aiConfigErr?.message}`)

  // ---- CRM contact (required FK target for conversations) + conversation ----
  // `contacts.account_id` is NOT NULL as of migration 017 (its RLS was
  // rewritten to is_account_member(account_id) at the same time — this
  // table is account-scoped, not merely user_id-scoped, contrary to an
  // earlier, incorrect version of this comment) and migration 022 adds
  // a UNIQUE(account_id, phone_normalized) index — both satisfied here.
  const { data: crmContact, error: crmErr } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: userId,
      phone: label === 'A' ? '+1-111-1111' : '+1-222-2222',
      name: `${marker} Customer`,
    })
    .select('id')
    .single()
  if (crmErr || !crmContact) throw new Error(`[rls-fixtures] contacts insert failed (${label}): ${crmErr?.message}`)

  const { data: conversation, error: convErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: crmContact.id,
      status: 'open',
      ai_catalog_context: {
        lastQuery: `${marker} query`,
        products: [{ id: `ds_${dataSource.id}:${productSourceProductId}`, name: `${marker} Secret Product` }],
        updatedAt: new Date().toISOString(),
      },
    })
    .select('id')
    .single()
  if (convErr || !conversation) throw new Error(`[rls-fixtures] conversations insert failed (${label}): ${convErr?.message}`)

  return {
    label,
    email,
    password: PASSWORD,
    userId,
    accountId,
    dataSourceId: dataSource.id,
    productId: product.id,
    productSourceProductId,
    knowledgeDocumentId: kbDoc.id,
    knowledgeChunkId: kbChunk.id,
    businessProfileId: bizProfile.id,
    departmentId: department.id,
    contactId: bizContact.id,
    aiConfigId: aiConfig.id,
    crmContactId: crmContact.id,
    conversationId: conversation.id,
  }
}

/** Seeds both tenants. Safe to call multiple times (idempotent via
 *  `deleteFixtureIfExists`). Uses `serviceRoleClient()` exclusively —
 *  never used to assert RLS behaviour. */
export async function seedRlsFixtures(): Promise<RlsFixtures> {
  const db = serviceRoleClient()
  const a = await seedOneAccount(db, 'A')
  const b = await seedOneAccount(db, 'B')
  return { a, b }
}

/** Tears down both tenants. Safe to call even if seeding partially
 *  failed (each step is keyed by email, not by in-memory ids). */
export async function cleanupRlsFixtures(): Promise<void> {
  const db = serviceRoleClient()
  await deleteFixtureIfExists(db, EMAIL_A)
  await deleteFixtureIfExists(db, EMAIL_B)
}
