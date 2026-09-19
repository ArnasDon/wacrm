import 'server-only'
import { getDb } from '@/lib/db/mongo'
import { newId } from '@/lib/db/ids'
import type { AccountDoc, BusinessProfile, SalesAgentSettings, UserDoc } from '@/lib/db/types'

export function defaultBusinessProfile(displayName: string): BusinessProfile {
  return {
    displayName,
    legalName: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    taxId: null,
    taxRateBps: 0,
    bank: { bankName: null, accountName: null, accountNumber: null },
    invoiceNotes: null,
    receiptFooter: 'Thank you for your patronage!',
    hasLogo: false,
    logoVersion: 0,
  }
}

export function defaultSalesAgentSettings(): SalesAgentSettings {
  return {
    name: 'Sales Assistant',
    enabled: false,
    mode: 'rules',
    aiProviderId: null,
    instructions:
      'You are a friendly, concise sales representative. Answer questions about our products, ' +
      'quote prices from the catalogue, and help customers place orders. Use Nigerian English ' +
      'politely. Never invent products or prices.',
    greeting: "Hello! I'm {name} from {business} — how can I help you today?",
    priceListKeywords: ['price', 'price list', 'pricelist', 'how much', 'catalogue', 'menu'],
    handoffKeywords: ['agent', 'human', 'manager', 'complain', 'complaint'],
    paymentProvider: 'paystack',
    autoSendPaymentLink: true,
    deliveryFee: 0,
    approvalThreshold: 0,
  }
}

/**
 * Create a brand-new account with `user` as its owner. Two inserts
 * without a transaction (standalone Mongo): the user row points at
 * the account, so the account is written first — a crash between
 * the two leaves an orphan account with no members, which is inert.
 */
export async function createAccountWithOwner(input: {
  email: string
  passwordHash: string
  fullName: string | null
  businessName: string
}): Promise<{ user: UserDoc; account: AccountDoc }> {
  const db = await getDb()
  const now = new Date()
  const userId = newId()
  const account: AccountDoc = {
    _id: newId(),
    name: input.businessName,
    ownerUserId: userId,
    currency: 'NGN',
    business: defaultBusinessProfile(input.businessName),
    salesAgent: defaultSalesAgentSettings(),
    createdAt: now,
    updatedAt: now,
  }
  const user: UserDoc = {
    _id: userId,
    email: input.email,
    passwordHash: input.passwordHash,
    fullName: input.fullName,
    avatarUrl: null,
    accountId: account._id,
    role: 'owner',
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  }
  await db.collection<AccountDoc>('accounts').insertOne(account)
  try {
    await db.collection<UserDoc>('users').insertOne(user)
  } catch (err) {
    await db.collection<AccountDoc>('accounts').deleteOne({ _id: account._id })
    throw err
  }
  return { user, account }
}

export async function loadAccount(accountId: string): Promise<AccountDoc | null> {
  const db = await getDb()
  const account = await db.collection<AccountDoc>('accounts').findOne({ _id: accountId })
  if (!account) return null
  // Accounts created before a setting existed get its default.
  account.salesAgent = { ...defaultSalesAgentSettings(), ...account.salesAgent }
  account.business = { ...defaultBusinessProfile(account.name), ...account.business }
  return account
}
