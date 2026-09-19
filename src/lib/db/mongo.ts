import 'server-only'
import { MongoClient, type Db } from 'mongodb'

// ============================================================
// MongoDB connection — one pooled client per server process.
//
// In dev, Next's hot reload re-evaluates modules; parking the
// client promise on globalThis keeps us from opening a new pool
// on every edit.
//
// Do NOT import `getDb()` from route handlers. Route code goes
// through `scopedCollection()` in ./scoped.ts, which injects the
// tenant filter. `getDb()` is exported only for that module, the
// auth layer, and index setup.
// ============================================================

const globalForMongo = globalThis as unknown as {
  _mongoClientPromise?: Promise<MongoClient>
  _mongoIndexesReady?: Promise<void>
}

function clientPromise(): Promise<MongoClient> {
  if (!globalForMongo._mongoClientPromise) {
    const uri = process.env.MONGODB_URI
    if (!uri) throw new Error('MONGODB_URI is not set')
    const client = new MongoClient(uri, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 10_000,
    })
    globalForMongo._mongoClientPromise = client.connect()
  }
  return globalForMongo._mongoClientPromise
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise()
  const db = client.db()
  if (!globalForMongo._mongoIndexesReady) {
    globalForMongo._mongoIndexesReady = ensureIndexes(db).catch((err) => {
      // Reset so the next request retries instead of caching failure.
      globalForMongo._mongoIndexesReady = undefined
      console.error('[mongo] index setup failed:', err)
    })
  }
  await globalForMongo._mongoIndexesReady
  return db
}

/**
 * Every tenant-scoped collection gets an index that starts with
 * accountId — without it every scoped query is a collection scan.
 * Unique indexes double as idempotency guards (the server is a
 * standalone node, so there are no multi-document transactions).
 */
async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    // --- identity ---
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('users').createIndex({ accountId: 1 }),
    db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('sessions').createIndex({ userId: 1 }),
    db.collection('password_resets').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('password_resets').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('invitations').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('invitations').createIndex({ accountId: 1, createdAt: -1 }),

    // --- whatsapp ---
    db.collection('whatsapp_configs').createIndex({ accountId: 1 }, { unique: true }),
    db.collection('whatsapp_configs').createIndex({ phoneNumberId: 1 }, { unique: true }),
    db.collection('contacts').createIndex({ accountId: 1, phone: 1 }, { unique: true }),
    db.collection('contacts').createIndex({ accountId: 1, createdAt: -1 }),
    db.collection('conversations').createIndex({ accountId: 1, contactId: 1 }, { unique: true }),
    db.collection('conversations').createIndex({ accountId: 1, lastMessageAt: -1 }),
    db.collection('messages').createIndex({ accountId: 1, conversationId: 1, createdAt: 1 }),
    db.collection('messages').createIndex(
      { waMessageId: 1 },
      { unique: true, partialFilterExpression: { waMessageId: { $type: 'string' } } },
    ),

    // --- sales ---
    db.collection('products').createIndex({ accountId: 1, name: 1 }),
    db.collection('products').createIndex(
      { accountId: 1, sku: 1 },
      { unique: true, partialFilterExpression: { sku: { $type: 'string' } } },
    ),
    db.collection('stock_movements').createIndex({ accountId: 1, productId: 1, createdAt: -1 }),
    db.collection('stock_movements').createIndex(
      { accountId: 1, orderId: 1, productId: 1, reason: 1 },
      { unique: true, partialFilterExpression: { orderId: { $exists: true } } },
    ),
    db.collection('orders').createIndex({ accountId: 1, createdAt: -1 }),
    db.collection('orders').createIndex({ accountId: 1, number: 1 }, { unique: true }),
    db.collection('orders').createIndex({ accountId: 1, contactId: 1, status: 1 }),
    db.collection('orders').createIndex(
      { accountId: 1, 'payment.reference': 1 },
      { unique: true, partialFilterExpression: { 'payment.reference': { $type: 'string' } } },
    ),
    db.collection('payment_events').createIndex(
      { accountId: 1, provider: 1, eventKey: 1 },
      { unique: true },
    ),
    db.collection('payment_proofs').createIndex({ accountId: 1, status: 1, createdAt: -1 }),
    db.collection('payment_proofs').createIndex({ accountId: 1, orderId: 1 }),
    db.collection('account_assets').createIndex({ accountId: 1, kind: 1 }, { unique: true }),
    db.collection('telegram_configs').createIndex({ accountId: 1 }, { unique: true }),
    db.collection('orders').createIndex({ accountId: 1, status: 1, createdAt: 1 }),
    db.collection('job_leases').createIndex({ until: 1 }, { expireAfterSeconds: 3600 }),
    db.collection('storage_configs').createIndex({ accountId: 1, provider: 1 }, { unique: true }),
    db.collection('counters').createIndex({ accountId: 1, name: 1 }, { unique: true }),
    db.collection('documents').createIndex({ accountId: 1, orderId: 1, kind: 1 }),

    // --- integrations ---
    db.collection('email_accounts').createIndex({ accountId: 1 }),
    db.collection('ai_providers').createIndex({ accountId: 1 }),
    db.collection('oauth_states').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('ai_runs').createIndex({ accountId: 1, createdAt: -1 }),
  ])
}
