import type { AccountRole } from '@/lib/auth/roles'
import type { ScopedDoc } from './scoped'

// ============================================================
// Document shapes. Money is ALWAYS integer minor units (kobo for
// NGN) — never floats — so totals, Paystack/Flutterwave amounts and
// receipts reconcile to the unit.
// ============================================================

// ---------- identity (not tenant-scoped: these define the tenant) ----------

export interface AccountDoc {
  _id: string
  name: string
  ownerUserId: string
  currency: string
  business: BusinessProfile
  salesAgent: SalesAgentSettings
  createdAt: Date
  updatedAt: Date
}

export interface BusinessProfile {
  displayName: string
  legalName: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  taxId: string | null
  /** VAT rate in basis points (750 = 7.5%). 0 = no tax line. */
  taxRateBps: number
  bank: { bankName: string | null; accountName: string | null; accountNumber: string | null }
  invoiceNotes: string | null
  receiptFooter: string | null
  hasLogo: boolean
  logoVersion: number
}

export interface SalesAgentSettings {
  /** The name the AI introduces itself with ("Hi, I'm Amaka from …"). */
  name: string
  enabled: boolean
  /** ai = LLM sales rep; rules = keyword price list + order parser only. */
  mode: 'ai' | 'rules'
  aiProviderId: string | null
  instructions: string
  greeting: string
  priceListKeywords: string[]
  handoffKeywords: string[]
  paymentProvider: 'paystack' | 'flutterwave' | 'bank_transfer'
  autoSendPaymentLink: boolean
  deliveryFee: number
  /** Orders above this total (minor units) wait for a human. 0 = never. */
  approvalThreshold: number
}

export interface UserDoc {
  _id: string
  email: string
  passwordHash: string
  fullName: string | null
  avatarUrl: string | null
  accountId: string
  role: AccountRole
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface SessionDoc {
  _id: string
  tokenHash: string
  userId: string
  userAgent: string | null
  ip: string | null
  expiresAt: Date
  lastSeenAt: Date
  createdAt: Date
}

export interface InvitationDoc extends ScopedDoc {
  tokenHash: string
  role: Exclude<AccountRole, 'owner'>
  label: string | null
  createdByUserId: string
  expiresAt: Date
  acceptedAt: Date | null
  acceptedByUserId: string | null
}

export interface AccountAssetDoc extends ScopedDoc {
  kind: 'logo'
  mime: string
  size: number
  data: import('mongodb').Binary
}

// ---------- whatsapp ----------

export interface WhatsAppConfigDoc extends ScopedDoc {
  phoneNumberId: string
  wabaId: string | null
  accessTokenEnc: string
  verifyTokenEnc: string | null
  /**
   * The Meta app secret that signs this tenant's webhooks. Each
   * merchant brings their own Meta app, so the secret belongs to the
   * account, not the server. `META_APP_SECRET` stays as a fallback for
   * single-tenant self-hosted installs.
   */
  appSecretEnc: string | null
  displayPhone: string | null
  verifiedName: string | null
  /** Last webhook Meta successfully delivered — the "is it wired up?" signal. */
  lastWebhookAt: Date | null
  /** Why the last delivery was refused (fixed strings, never attacker text). */
  lastWebhookError: string | null
  lastWebhookErrorAt: Date | null
}

// ---------- knowledge base ----------

/**
 * Things the sales rep should know that aren't products: turnaround,
 * revisions, opening hours, delivery areas, refund policy. Injected
 * into the AI prompt so the rep answers instead of handing off.
 */
export interface KnowledgeDoc extends ScopedDoc {
  /** What a customer asks, in their words. */
  question: string
  /** The answer the rep may give, verbatim facts only. */
  answer: string
  isActive: boolean
}

export interface ContactDoc extends ScopedDoc {
  phone: string
  name: string | null
  email: string | null
  notes: string | null
  tags: string[]
  /** Test customer from the sales-rep playground — never messaged via Meta. */
  isSandbox: boolean
}

export interface ConversationDoc extends ScopedDoc {
  contactId: string
  status: 'open' | 'closed'
  assignedUserId: string | null
  lastMessageAt: Date
  lastMessagePreview: string | null
  lastInboundAt: Date | null
  unreadCount: number
  /** Human took over — the AI sales rep stays quiet on this chat. */
  aiPaused: boolean
  aiPausedReason: string | null
  /** Per-conversation lock so two quick messages don't run the sales rep twice. */
  aiLockUntil?: Date | null
  /** A message arrived while locked — the lock holder re-runs once. */
  aiPending?: boolean
}

export type MessageSender = 'customer' | 'agent' | 'ai' | 'system'

export interface MessageDoc extends ScopedDoc {
  conversationId: string
  contactId: string
  direction: 'inbound' | 'outbound'
  sender: MessageSender
  senderUserId: string | null
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'interactive' | 'other'
  text: string | null
  media: {
    id: string | null
    mime: string | null
    filename: string | null
    /** Internal link for generated documents (invoice/receipt PDFs). */
    href?: string | null
  } | null
  waMessageId: string | null
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'
  error: string | null
}

// ---------- sales ----------

export interface ProductDoc extends ScopedDoc {
  name: string
  sku: string | null
  description: string | null
  category: string | null
  unit: string
  /** Minor units. */
  price: number
  /** null = stock not tracked (services, made-to-order). */
  stock: number | null
  lowStockThreshold: number
  /** Extra names customers use ("coke", "coca cola 50cl"). */
  aliases: string[]
  isActive: boolean
  /** Photos on Cloudinary. First = cover. */
  images?: ProductImageRef[]
}

export interface ProductImageRef {
  id: string
  /** Which storage holds it (missing on early images = cloudinary). */
  provider?: StorageProvider
  /** Cloudinary public_id or S3 object key — always under wacrm/<accountId>/products/. */
  publicId: string
  /**
   * Delivery URL. Absolute for Cloudinary / public buckets; for
   * private buckets an app-relative `/api/media/...` proxy path.
   */
  url: string
  mime?: string
  width: number
  height: number
  bytes: number
}

export type StorageProvider = 'cloudinary' | 's3'

/**
 * Where this business keeps product photos. One doc per provider;
 * `isActive` marks the one new uploads go to (old photos stay on
 * whichever provider holds them and can still be deleted).
 */
export interface StorageConfigDoc extends ScopedDoc {
  provider: StorageProvider
  isActive: boolean
  cloudinary: { cloudName: string; apiKey: string; apiSecretEnc: string } | null
  s3: {
    preset: string
    region: string
    bucket: string
    endpoint: string | null
    accessKeyId: string
    secretAccessKeyEnc: string
    /** Public base URL (bucket website / CDN). Null = serve via the app proxy. */
    publicBaseUrl: string | null
    forcePathStyle: boolean
  } | null
  lastTestAt: Date | null
  lastTestOk: boolean | null
}

export interface StockMovementDoc extends ScopedDoc {
  productId: string
  delta: number
  reason: 'restock' | 'adjustment' | 'order' | 'order_cancel'
  orderId?: string
  note: string | null
  userId: string
}

export type OrderStatus = 'draft' | 'awaiting_payment' | 'paid' | 'fulfilled' | 'cancelled'
export type PaymentProvider = 'paystack' | 'flutterwave'

export interface OrderItem {
  productId: string
  name: string
  sku: string | null
  unitPrice: number
  quantity: number
  lineTotal: number
}

export interface OrderDoc extends ScopedDoc {
  number: string
  contactId: string | null
  conversationId: string | null
  customer: { name: string | null; phone: string | null; email: string | null }
  items: OrderItem[]
  subtotal: number
  deliveryFee: number
  discount: number
  tax: number
  total: number
  currency: string
  status: OrderStatus
  source: 'ai' | 'rules' | 'manual'
  notes: string | null
  stockCommitted: boolean
  payment: {
    provider: PaymentProvider | 'bank_transfer' | 'manual' | null
    reference: string | null
    /** References of superseded payment links — a late payment on an
     *  old link must still settle the order. */
    previousReferences: string[]
    link: string | null
    status: 'none' | 'pending' | 'proof_submitted' | 'paid' | 'failed'
    amountPaid: number | null
    channel: string | null
    providerTransactionId: string | null
    paidAt: Date | null
  }
  invoiceNumber: string | null
  receiptNumber: string | null
  receiptSentAt: Date | null
  /** Payment reminder sent (background work, once per order). */
  reminderSentAt?: Date | null
  createdByUserId: string
}

/**
 * A customer's proof of a manual bank transfer (screenshot / PDF sent
 * on WhatsApp). Never auto-approved — fake transfer screenshots are a
 * common scam; a staff member confirms against the bank account.
 */
export interface PaymentProofDoc extends ScopedDoc {
  orderId: string
  conversationId: string | null
  contactId: string | null
  messageId: string | null
  media: { id: string | null; mime: string | null; filename: string | null; href?: string | null } | null
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewedByUserId: string | null
  reviewedAt: Date | null
  reviewNote: string | null
  amountConfirmed: number | null
}

export interface PaymentConfigDoc extends ScopedDoc {
  provider: PaymentProvider
  enabled: boolean
  publicKey: string | null
  secretKeyEnc: string
  /** Flutterwave "secret hash" for the verif-hash header. */
  webhookHashEnc: string | null
}

export interface PaymentEventDoc extends ScopedDoc {
  provider: PaymentProvider
  eventKey: string
  orderId: string | null
  outcome: string
}

export interface CounterDoc extends ScopedDoc {
  name: string
  seq: number
}

// ---------- integrations ----------

export interface EmailAccountDoc extends ScopedDoc {
  provider: 'smtp' | 'gmail'
  label: string
  fromName: string | null
  fromEmail: string
  isDefault: boolean
  smtp: {
    host: string
    port: number
    secure: boolean
    username: string
    passwordEnc: string
  } | null
  gmail: { refreshTokenEnc: string; scope: string } | null
  lastTestAt: Date | null
  lastTestOk: boolean | null
}

export type AIProviderKind = 'openai' | 'anthropic' | 'gemini' | 'openai_compatible'

export interface AIProviderDoc extends ScopedDoc {
  label: string
  kind: AIProviderKind
  preset: string
  baseUrl: string | null
  apiKeyEnc: string | null
  model: string
  isDefault: boolean
  lastTestAt: Date | null
  lastTestOk: boolean | null
  /** The provider's own error text from the last failed test. */
  lastTestError?: string | null
}

export interface AIRunDoc extends ScopedDoc {
  conversationId: string
  providerId: string
  model: string
  ok: boolean
  latencyMs: number
  actions: string[]
  error: string | null
}

// ---------- notifications ----------

export type NotifyEvent = 'orderCreated' | 'orderPaid' | 'proofSubmitted' | 'handoff'

/**
 * One Telegram bot per merchant (they create it with @BotFather).
 * The token is encrypted; `chats` are the Telegram chats that proved
 * ownership by sending the one-time link code to THIS bot.
 */
export interface TelegramConfigDoc extends ScopedDoc {
  botTokenEnc: string
  botUsername: string
  botId: string
  linkCode: string
  chats: Array<{ chatId: string; title: string; linkedAt: Date }>
  events: Record<NotifyEvent, boolean>
  enabled: boolean
  lastUpdateId: number
}

export interface OAuthStateDoc {
  _id: string
  accountId: string
  userId: string
  purpose: 'gmail'
  expiresAt: Date
}
