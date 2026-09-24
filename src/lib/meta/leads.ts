// ============================================================
// leads.ts — Lead Ads: recebe um evento `leadgen` do webhook da
// Página, busca os dados do lead à Graph API, cria/reaproveita o
// contacto e a conversa, sincroniza com o Twenty e envia o template
// de abertura.
//
// Mirrors deliberadamente o desenho já usado para o Click to WhatsApp
// (findOrCreateContact/findOrCreateConversation em
// src/app/api/whatsapp/webhook/route.ts, syncMetaAdLeadToCrm em
// src/lib/crm/sync.ts) — mesma tenancy (account_id/user_id), mesmo
// tratamento de corrida (unique violation → re-resolve em vez de
// falhar), mesma disciplina de nunca deixar uma falha a jusante
// (Twenty, envio de template) derrubar o registo do lead.
//
// Idempotência: `meta_leads.leadgen_id` é UNIQUE (migração 059). A
// linha é reservada por um INSERT logo no início de
// `processLeadgenEvent`, antes de qualquer chamada de rede — um
// redelivery do mesmo evento (Meta reenvia webhooks não confirmados)
// bate na UNIQUE e sai sem reprocessar nada.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { META_API_BASE } from '@/lib/whatsapp/meta-api'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { engineSendTemplate } from '@/lib/automations/meta-send'
import { syncMetaLeadToCrm } from '@/lib/crm/sync'
import { pickPersonaTemplate } from './lead-templates'

export interface LeadgenChangeValue {
  leadgen_id: string
  page_id: string
  form_id?: string
  /** Meta's webhook payload has used both `ad_id` and the legacy
   *  `adgroup_id` name across API versions — accept either. */
  ad_id?: string
  adgroup_id?: string
  adset_id?: string
  campaign_id?: string
  created_time?: number
}

export interface WhatsappConfigForLead {
  id: string
  account_id: string
  user_id: string
  phone_number_id: string
  waba_id: string | null
  access_token: string
}

/**
 * Resolve which account's WhatsApp config owns a Page, by
 * `meta_page_id` (migration 059). Mirrors the phone_number_id lookup
 * in the messages webhook — same ≥2-rows guard, since a duplicate
 * mapping would otherwise silently pick an arbitrary account.
 */
export async function findConfigForPage(
  db: SupabaseClient,
  pageId: string,
): Promise<WhatsappConfigForLead | null> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('id, account_id, user_id, phone_number_id, waba_id, access_token')
    .eq('meta_page_id', pageId)

  if (error) {
    console.error('[meta leads] falha a procurar whatsapp_config por meta_page_id:', error.message)
    return null
  }
  if (!data || data.length === 0) return null
  if (data.length > 1) {
    console.error(
      `[meta leads] múltiplas configs (${data.length}) para page_id=${pageId} — lead descartado. ` +
        'Resolver o mapeamento duplicado em whatsapp_config.meta_page_id.',
    )
    return null
  }
  return data[0] as WhatsappConfigForLead
}

export interface RawLeadField {
  name: string
  values: string[]
}

export interface RawLeadData {
  id: string
  ad_id?: string
  adset_id?: string
  campaign_id?: string
  form_id?: string
  created_time?: string
  platform?: string
  field_data: RawLeadField[]
}

/**
 * GET /{leadgen_id}?fields=field_data,ad_id,adset_id,campaign_id,form_id,created_time,platform
 * https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving
 */
export async function fetchLeadFromGraph(
  leadgenId: string,
  accessToken: string,
): Promise<RawLeadData> {
  const url =
    `${META_API_BASE}/${leadgenId}` +
    '?fields=field_data,ad_id,adset_id,campaign_id,form_id,created_time,platform'
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(`Graph API leadgen fetch falhou (HTTP ${response.status}): ${bodyText.slice(0, 300)}`)
  }
  return (await response.json()) as RawLeadData
}

function fieldValue(fields: RawLeadField[], ...names: string[]): string | null {
  for (const name of names) {
    const match = fields.find((f) => f.name === name)
    if (match?.values?.[0]) return match.values[0]
  }
  return null
}

export interface NormalizedLead {
  fullName: string | null
  email: string | null
  /** Digits-only (via normalizePhone), or null when the form had no
   *  usable phone field. */
  phone: string | null
  company: string | null
  /** null when the form has no consent question at all (nothing to
   *  gate on); false only when the lead explicitly answered no. */
  consent: boolean | null
}

/**
 * Meta's `field_data` keys depend on which standard/custom fields the
 * form asks for. We accept both the English standard keys and the
 * Portuguese custom-question keys the brief's form payload (see
 * lead-templates.ts's sibling doc in the task report) asks for, so
 * this keeps working whichever the actual form ends up using.
 */
export function normalizeLeadFields(fieldData: RawLeadField[]): NormalizedLead {
  const firstName = fieldValue(fieldData, 'first_name')
  const lastName = fieldValue(fieldData, 'last_name')
  const fullNameField = fieldValue(fieldData, 'full_name', 'nome', 'name')
  const fullName =
    fullNameField || [firstName, lastName].filter(Boolean).join(' ').trim() || null

  const email = fieldValue(fieldData, 'email')

  const rawPhone = fieldValue(fieldData, 'phone_number', 'phone', 'telefone')
  const phone = rawPhone ? normalizePhone(rawPhone) : null

  const company = fieldValue(fieldData, 'company_name', 'company', 'empresa')

  const consentRaw = fieldValue(
    fieldData,
    'consentimento_whatsapp',
    'whatsapp_consent',
    'contacto_por_whatsapp',
    'aceita_ser_contactado_por_whatsapp',
  )
  const consent = consentRaw == null ? null : /^(sim|yes|true|1)$/i.test(consentRaw.trim())

  return { fullName, email, phone: phone || null, company, consent }
}

async function markTemplateStatus(
  db: SupabaseClient,
  metaLeadId: string,
  status: 'skipped_no_consent' | 'skipped_no_phone',
): Promise<void> {
  const { error } = await db
    .from('meta_leads')
    .update({ template_status: status })
    .eq('id', metaLeadId)
  if (error) {
    console.error(`[meta leads] falha a marcar template_status=${status} (lead=${metaLeadId}):`, error.message)
  }
}

interface LeadContact {
  id: string
  name: string
  phone: string
  email: string | null
  company: string | null
}

async function findOrCreateLeadContact(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  normalized: NormalizedLead,
): Promise<LeadContact> {
  const phone = normalized.phone!
  const name = normalized.fullName || phone

  const existing = await findExistingContact(db, accountId, phone)
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (normalized.fullName && normalized.fullName !== existing.name) patch.name = normalized.fullName
    if (normalized.email && !existing.email) patch.email = normalized.email
    if (normalized.company && !existing.company) patch.company = normalized.company
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString()
      await db.from('contacts').update(patch).eq('id', existing.id)
    }
    return existing as unknown as LeadContact
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: userId,
      phone,
      name,
      email: normalized.email,
      company: normalized.company,
    })
    .select()
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, phone)
      if (raced) return raced as unknown as LeadContact
    }
    throw new Error(`falha a criar contacto do lead: ${error.message}`)
  }
  return created as LeadContact
}

interface LeadConversation {
  id: string
}

async function findOrCreateLeadConversation(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
  adId: string | null,
): Promise<LeadConversation> {
  const { data: existingRows, error: findErr } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findErr) throw new Error(`falha a procurar conversa do lead: ${findErr.message}`)
  if (existingRows && existingRows.length > 0) return existingRows[0] as LeadConversation

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      source: 'meta_lead_ad',
      ad_id: adId,
      first_referral_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) return raced[0] as LeadConversation
    }
    throw new Error(`falha a criar conversa do lead: ${error.message}`)
  }
  return created as LeadConversation
}

/** Heuristic for "Meta rejected the template name/params because the
 *  template isn't approved yet" vs. any other send failure. Meta's
 *  error codes for this: 132001 (template does not exist), 132012
 *  (param count mismatch — usually means the template shape changed
 *  since submission and needs re-approval). Conservative: anything
 *  else is treated as a real failure, not silently swallowed as
 *  "pending approval". */
function isTemplateNotReadyError(message: string): boolean {
  return /132001|132012|template.*(not found|does not exist|unavailable)/i.test(message)
}

export interface ProcessLeadResult {
  outcome: 'processed' | 'duplicate'
  metaLeadId?: string
}

export async function processLeadgenEvent(
  db: SupabaseClient,
  config: WhatsappConfigForLead,
  change: LeadgenChangeValue,
): Promise<ProcessLeadResult> {
  const adIdFromWebhook = change.ad_id ?? change.adgroup_id ?? null

  // Claim the row FIRST — before any network call — so a redelivered
  // or duplicate webhook event can never process the same lead twice.
  const { data: inserted, error: insertErr } = await db
    .from('meta_leads')
    .insert({
      account_id: config.account_id,
      leadgen_id: change.leadgen_id,
      page_id: change.page_id,
      form_id: change.form_id ?? null,
      ad_id: adIdFromWebhook,
      adset_id: change.adset_id ?? null,
      campaign_id: change.campaign_id ?? null,
    })
    .select('id')
    .maybeSingle()

  if (insertErr) {
    if (isUniqueViolation(insertErr)) {
      console.log(`[meta leads] leadgen_id=${change.leadgen_id} já processado — ignorado (idempotente).`)
      return { outcome: 'duplicate' }
    }
    throw new Error(`falha a reservar meta_leads: ${insertErr.message}`)
  }
  const metaLeadId = (inserted as { id: string }).id

  try {
    const accessToken = decrypt(config.access_token)
    const raw = await fetchLeadFromGraph(change.leadgen_id, accessToken)
    const normalized = normalizeLeadFields(raw.field_data)
    const adId = raw.ad_id ?? adIdFromWebhook

    await db
      .from('meta_leads')
      .update({
        full_name: normalized.fullName,
        email: normalized.email,
        phone: normalized.phone,
        company: normalized.company,
        consentimento_whatsapp: normalized.consent,
        platform: raw.platform ?? null,
        lead_created_time: raw.created_time
          ? new Date(Number(raw.created_time) * 1000).toISOString()
          : null,
        ad_id: adId,
        adset_id: raw.adset_id ?? change.adset_id ?? null,
        campaign_id: raw.campaign_id ?? change.campaign_id ?? null,
        form_id: raw.form_id ?? change.form_id ?? null,
        raw_field_data: raw.field_data,
      })
      .eq('id', metaLeadId)

    if (normalized.consent === false) {
      await markTemplateStatus(db, metaLeadId, 'skipped_no_consent')
      return { outcome: 'processed', metaLeadId }
    }
    if (!normalized.phone) {
      await markTemplateStatus(db, metaLeadId, 'skipped_no_phone')
      return { outcome: 'processed', metaLeadId }
    }

    const contact = await findOrCreateLeadContact(db, config.account_id, config.user_id, normalized)
    const conversation = await findOrCreateLeadConversation(
      db,
      config.account_id,
      config.user_id,
      contact.id,
      adId,
    )

    await db
      .from('meta_leads')
      .update({ contact_id: contact.id, conversation_id: conversation.id })
      .eq('id', metaLeadId)

    // Fire-and-forget — Twenty being down/slow must never affect the
    // lead's WhatsApp template send below. Never throws (see sync.ts).
    void syncMetaLeadToCrm({
      db,
      accountId: config.account_id,
      metaLeadId,
      contactId: contact.id,
    })

    const template = pickPersonaTemplate(adId)
    const firstName = normalized.fullName?.trim().split(/\s+/)[0] || normalized.fullName || 'olá'

    try {
      const sendResult = await engineSendTemplate({
        accountId: config.account_id,
        userId: config.user_id,
        conversationId: conversation.id,
        contactId: contact.id,
        templateName: template.name,
        language: template.language,
        params: [firstName],
      })
      await db
        .from('meta_leads')
        .update({
          template_status: 'sent',
          template_name: template.name,
          template_message_id: sendResult.whatsapp_message_id,
          template_error: null,
        })
        .eq('id', metaLeadId)
    } catch (sendErr) {
      const msg = sendErr instanceof Error ? sendErr.message : String(sendErr)
      const notReady = isTemplateNotReadyError(msg)
      await db
        .from('meta_leads')
        .update({
          template_status: notReady ? 'template_pendente' : 'failed',
          template_name: template.name,
          template_error: msg.slice(0, 500),
        })
        .eq('id', metaLeadId)
      console.error(
        `[meta leads] envio de template falhou (lead=${metaLeadId}, template=${template.name}, pronto=${!notReady}):`,
        msg,
      )
    }

    return { outcome: 'processed', metaLeadId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db
      .from('meta_leads')
      .update({ template_status: 'failed', template_error: msg.slice(0, 500) })
      .eq('id', metaLeadId)
    console.error(`[meta leads] processamento falhou (lead=${metaLeadId}):`, msg)
    return { outcome: 'processed', metaLeadId }
  }
}
