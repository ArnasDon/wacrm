// ============================================================
// Business Profile — types shared by the service layer, the prompt
// context builder, the handoff-intent matcher, and the Settings UI.
//
// Deliberately generic (AI optimization project, FASE 6): nothing here
// names an industry or product category. The same shape serves a phone
// store, a hardware store, a restaurant, or a hair salon.
// ============================================================

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export type Weekday = (typeof WEEKDAYS)[number]

export interface DayHours {
  enabled: boolean
  /** "HH:MM", 24h. Meaningless (and ignored) when `enabled` is false. */
  open: string | null
  close: string | null
}

export type BusinessHours = Partial<Record<Weekday, DayHours>>

export interface BusinessLink {
  label: string
  url: string
  /** Free-form ('social' | 'website' | ...) — not an enum, so a new
   *  kind of link never needs a migration. */
  type: string
}

export interface BusinessFaqItem {
  question: string
  answer: string
}

export interface BusinessProfileRow {
  id: string
  accountId: string
  businessName: string | null
  description: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  website: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  googleMapsUrl: string | null
  businessHours: BusinessHours
  deliveryEnabled: boolean
  deliveryDescription: string | null
  deliveryCoverageAreas: string[]
  paymentMethods: string[]
  warrantyPolicy: string | null
  returnPolicy: string | null
  financingPolicy: string | null
  deliveryPolicy: string | null
  links: BusinessLink[]
  faq: BusinessFaqItem[]
  createdAt: string
  updatedAt: string
}

/** Every field optional — a PATCH-style upsert input. `undefined` means
 *  "leave unchanged" (on update) or "use the column default" (on
 *  create); there is no separate "explicitly clear" sentinel because
 *  every field here is safe to represent as null/empty directly. */
export type BusinessProfileInput = Partial<
  Omit<BusinessProfileRow, 'id' | 'accountId' | 'createdAt' | 'updatedAt'>
>

export interface DepartmentRow {
  id: string
  accountId: string
  name: string
  description: string | null
  active: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface DepartmentInput {
  name: string
  description?: string | null
  active?: boolean
  sortOrder?: number
}

export interface ContactRow {
  id: string
  accountId: string
  departmentId: string | null
  name: string
  roleTitle: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  /** Internal admin annotation — see business-profile/context.ts's doc:
   *  never sent to the model. */
  notes: string | null
  active: boolean
  sortOrder: number
  /** Optional link to a real CRM member — see migration 050's doc. */
  linkedUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface ContactInput {
  name: string
  departmentId?: string | null
  roleTitle?: string | null
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  notes?: string | null
  active?: boolean
  sortOrder?: number
  linkedUserId?: string | null
}
