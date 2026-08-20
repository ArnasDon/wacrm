'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Contact, MessageTemplate } from '@/types';
import { resolveVariables, type VariableMapping } from '@/lib/whatsapp/template-variables';

export { resolveVariables, type VariableMapping };

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

/**
 * Campaigns audience — the single shared shape used by the wizard
 * (step2/step4), the list/detail pages, and this hook. Grew out of
 * Broadcasts' original 'all' | 'tags' | 'custom_field' | 'csv' to add
 * the audience dimensions Campaigns needs (section 3 of the spec) —
 * all resolved with machinery that already existed elsewhere in the
 * CRM (segments, deals/pipeline stages, the Contacts custom-field
 * filter) rather than a new segmentation system.
 */
export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv' | 'contacts' | 'segment' | 'pipeline_stage';
  tagIds?: string[];
  /**
   * When true and tagIds has 2+ entries, a contact must carry EVERY tag
   * (AND, via filter_contacts_by_all_tags) rather than ANY of them (OR,
   * the default) — same toggle as the Contacts list (migration 039).
   */
  matchAll?: boolean;
  /** @deprecated single-filter shape, kept so older stored audience_filter rows still resolve. Prefer customFields. */
  customField?: CustomFieldFilter;
  /** Multiple custom-field filters, ANDed together (tipo de imóvel + faixa de preço + …). */
  customFields?: CustomFieldFilter[];
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
  /** type: 'contacts' — explicit lead picks (individual selection, section 3). */
  contactIds?: string[];
  /** type: 'segment' — resolves via segment_tags with matchAll semantics (migration 040). */
  segmentId?: string;
  /** type: 'pipeline_stage' — contacts with a non-archived deal in this stage. */
  pipelineStageId?: string;
}

interface BroadcastPayload {
  name: string;
  description?: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /**
   * Media URL for an IMAGE/VIDEO/DOCUMENT header. Required at send
   * time for media-header templates — Meta rejects the send without
   * it. Passed through as `messageParams.headerMediaUrl`; the builder
   * falls back to the template's stored URL only when this is empty.
   */
  headerMediaUrl?: string;
}

interface UseBroadcastSendingReturn {
  /** Resolve + persist recipients, then send immediately (existing "Send Now" flow). */
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  /**
   * Resolve + persist recipients WITHOUT sending — status 'ready'. Used
   * by the "review recipients, then decide" step (section 3 of the
   * spec): the campaign's recipient list is locked in, sendable later
   * via `startCampaignSending`.
   */
  saveCampaignReady: (payload: BroadcastPayload) => Promise<string>;
  /**
   * Send every `pending` recipient already attached to an existing
   * campaign — no audience re-resolution. This is BOTH "iniciar envio"
   * for a 'ready' campaign AND "continuar envio" after a page
   * reload/closed tab interrupted a 'sending' one: since recipient
   * rows are unique per (campaign, contact) and already-sent rows
   * aren't 'pending' anymore, re-running this is naturally idempotent
   * — nothing gets a duplicate message (section 5 of the spec).
   */
  startCampaignSending: (campaignId: string) => Promise<void>;
  /** Read-only preview — resolves an audience without writing anything, for the "X contacts found" / recipient list preview. */
  previewAudience: (audience: AudienceConfig) => Promise<Contact[]>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

/** `broadcast_recipients` inserts are independent of the send rate. */
const INSERT_BATCH_SIZE = 200;

/**
 * filter_contacts_by_all_tags is paginated (built for the Contacts list
 * view); broadcast sending needs every match in one shot, so we page it
 * with a limit far above any realistic account size instead of adding a
 * second unpaginated RPC.
 */
const MATCH_ALL_TAGS_LIMIT = 100000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

/** contactId → (customFieldId → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 */
async function fetchCustomValueIndex(
  supabase: ReturnType<typeof createClient>,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  // Supabase PostgREST caps the .in(...) IN-clause roughly at 1000
  // values. Page through to stay safe.
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', slice);

    for (const row of data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    const supabase = createClient();

    let contacts: Contact[] = [];

    if (audience.type === 'all') {
      const { data, error } = await supabase.from('contacts').select('*');
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = data ?? [];
    } else if (
      audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      if (audience.matchAll && audience.tagIds.length > 1) {
        const { data, error } = await supabase.rpc('filter_contacts_by_all_tags', {
          p_tag_ids: audience.tagIds,
          p_search: null,
          p_limit: MATCH_ALL_TAGS_LIMIT,
          p_offset: 0,
        });
        if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
        contacts = ((data ?? []) as { contact: Contact }[]).map((r) => r.contact);
      } else {
        const { data: contactTags, error: tagError } = await supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.tagIds);

        if (tagError)
          throw new Error(`Failed to fetch contact tags: ${tagError.message}`);

        if (contactTags && contactTags.length > 0) {
          const uniqueContactIds = [
            ...new Set(contactTags.map((ct) => ct.contact_id)),
          ];
          const { data, error } = await supabase
            .from('contacts')
            .select('*')
            .in('id', uniqueContactIds);
          if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
          contacts = data ?? [];
        }
      }
    } else if (audience.type === 'custom_field') {
      const filters = audience.customFields?.length
        ? audience.customFields
        : audience.customField
          ? [audience.customField]
          : [];
      contacts = await resolveCustomFieldAudience(supabase, filters);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(supabase, audience.csvContacts);
    } else if (audience.type === 'contacts' && audience.contactIds?.length) {
      contacts = await resolveExplicitContacts(supabase, audience.contactIds);
    } else if (audience.type === 'segment' && audience.segmentId) {
      contacts = await resolveSegmentAudience(supabase, audience.segmentId);
    } else if (audience.type === 'pipeline_stage' && audience.pipelineStageId) {
      contacts = await resolvePipelineStageAudience(supabase, audience.pipelineStageId);
    }

    // Apply exclude tags (works across all contact-derived audience
    // types). CSV contacts are synthetic so exclusion doesn't apply.
    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const { data: excludeRows } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.excludeTagIds);
      const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    return contacts;
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   *
   * Pre-existing implementation synthesized `csv-N` strings as
   * contact_id, which failed the UUID cast on insert — every CSV
   * broadcast silently created zero recipients.
   */
  async function upsertCsvContacts(
    supabase: ReturnType<typeof createClient>,
    csvRows: { phone: string; name?: string }[],
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      throw new Error('You are not signed in.');
    }
    if (!accountId) {
      throw new Error('Your profile is not linked to an account.');
    }

    // De-duplicate by phone within the CSV (users can paste duplicates).
    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      if (row.phone) uniqueByPhone.set(row.phone, row);
    }
    const phones = [...uniqueByPhone.keys()];

    // Single round-trip lookup of existing contacts by phone.
    const { data: existing, error: lookupErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', user.id)
      .in('phone', phones);
    if (lookupErr) {
      throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
    }

    const byPhone = new Map<string, Contact>();
    for (const c of (existing ?? []) as Contact[]) {
      if (c.phone) byPhone.set(c.phone, c);
    }

    // Insert only missing contacts, in one batch per 200 rows (PostgREST
    // has a default payload cap — 200 keeps individual requests small).
    const missing = phones
      .filter((p) => !byPhone.has(p))
      .map((phone) => ({
        user_id: user.id,
        account_id: accountId,
        phone,
        name: uniqueByPhone.get(phone)?.name ?? null,
      }));

    const INSERT_CHUNK = 200;
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const { data: inserted, error: insertErr } = await supabase
        .from('contacts')
        .insert(chunk)
        .select();
      if (insertErr) {
        throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
      }
      for (const c of (inserted ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    // Preserve input order so analytics roughly matches the CSV order.
    return phones
      .map((p) => byPhone.get(p))
      .filter((c): c is Contact => Boolean(c));
  }

  /** One filter's matching contact_ids — shared by the AND-intersection below. */
  async function matchCustomField(
    supabase: ReturnType<typeof createClient>,
    filter: CustomFieldFilter,
  ): Promise<Set<string>> {
    const { fieldId, operator, value } = filter;
    // PostgREST supports eq/neq/ilike via the query builder — use ilike
    // with wildcards for "contains" so the match is case-insensitive.
    let query = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);

    if (operator === 'is') query = query.eq('value', value);
    else if (operator === 'is_not') query = query.neq('value', value);
    else if (operator === 'contains') query = query.ilike('value', `%${value}%`);

    const { data: matches, error: matchErr } = await query;
    if (matchErr)
      throw new Error(`Custom-field filter failed: ${matchErr.message}`);
    return new Set((matches ?? []).map((m) => m.contact_id as string));
  }

  /**
   * Real-estate CRM fields like "tipo de imóvel", "faixa de preço",
   * "localização" are modeled as custom fields (there's no dedicated
   * schema for them) — Campaigns lets multiple such filters be ANDed
   * together (e.g. tipo=Apartamento AND faixa=Até 350 mil) rather than
   * inventing a second, parallel filter system for them.
   */
  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filters: CustomFieldFilter[],
  ): Promise<Contact[]> {
    const usable = filters.filter((f) => f.fieldId && f.value);
    if (usable.length === 0) return [];

    let contactIds: Set<string> | null = null;
    for (const filter of usable) {
      const matched = await matchCustomField(supabase, filter);
      contactIds = contactIds ? intersect(contactIds, matched) : matched;
      if (contactIds.size === 0) break;
    }
    if (!contactIds || contactIds.size === 0) return [];

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', [...contactIds]);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return data ?? [];
  }

  function intersect(a: Set<string>, b: Set<string>): Set<string> {
    const out = new Set<string>();
    for (const id of a) if (b.has(id)) out.add(id);
    return out;
  }

  /** type: 'contacts' — individual lead picks, section 3 of the spec. */
  async function resolveExplicitContacts(
    supabase: ReturnType<typeof createClient>,
    contactIds: string[],
  ): Promise<Contact[]> {
    if (contactIds.length === 0) return [];
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', contactIds);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return data ?? [];
  }

  /**
   * type: 'segment' — a saved tag combination (migration 040) resolves
   * to the same AND-tag machinery Segments was built to feed, per its
   * own migration comment.
   */
  async function resolveSegmentAudience(
    supabase: ReturnType<typeof createClient>,
    segmentId: string,
  ): Promise<Contact[]> {
    const { data: tagRows, error: tagErr } = await supabase
      .from('segment_tags')
      .select('tag_id')
      .eq('segment_id', segmentId);
    if (tagErr) throw new Error(`Failed to read segment: ${tagErr.message}`);
    const tagIds = (tagRows ?? []).map((r) => r.tag_id as string);
    if (tagIds.length === 0) return [];

    if (tagIds.length > 1) {
      const { data, error } = await supabase.rpc('filter_contacts_by_all_tags', {
        p_tag_ids: tagIds,
        p_search: null,
        p_limit: MATCH_ALL_TAGS_LIMIT,
        p_offset: 0,
      });
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      return ((data ?? []) as { contact: Contact }[]).map((r) => r.contact);
    }

    const { data: contactTags, error: ctErr } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', tagIds);
    if (ctErr) throw new Error(`Failed to fetch contact tags: ${ctErr.message}`);
    const ids = [...new Set((contactTags ?? []).map((r) => r.contact_id))];
    if (ids.length === 0) return [];
    const { data, error } = await supabase.from('contacts').select('*').in('id', ids);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return data ?? [];
  }

  /**
   * type: 'pipeline_stage' — contacts with a non-archived deal
   * currently sitting in this stage. Reuses the same `deals` table the
   * Kanban board and useLeadPipelineStage already read.
   */
  async function resolvePipelineStageAudience(
    supabase: ReturnType<typeof createClient>,
    stageId: string,
  ): Promise<Contact[]> {
    const { data: deals, error: dealsErr } = await supabase
      .from('deals')
      .select('contact_id')
      .eq('stage_id', stageId)
      .is('archived_at', null);
    if (dealsErr) throw new Error(`Failed to read pipeline stage: ${dealsErr.message}`);
    const ids = [
      ...new Set((deals ?? []).map((d) => d.contact_id as string).filter(Boolean)),
    ];
    if (ids.length === 0) return [];
    const { data, error } = await supabase.from('contacts').select('*').in('id', ids);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return data ?? [];
  }

  async function previewAudience(audience: AudienceConfig): Promise<Contact[]> {
    return resolveAudience(audience);
  }

  /**
   * Shared by createAndSendBroadcast + saveCampaignReady: resolve the
   * current user/account, resolve the audience, create the `broadcasts`
   * row, and upsert `broadcast_recipients`. `.upsert(...,
   * { onConflict: 'broadcast_id,contact_id', ignoreDuplicates: true })`
   * (backed by migration 075's unique index) means a retried/duplicated
   * insert call is a no-op rather than a duplicate row — the DB-level
   * guarantee the spec asks for, not just a frontend guard.
   */
  async function materializeCampaign(
    payload: BroadcastPayload,
    status: 'sending' | 'ready',
  ): Promise<{ broadcastId: string; recipientCount: number }> {
    const supabase = createClient();

    // broadcasts.user_id is NOT NULL + guarded by RLS
    // (auth.uid() = user_id). Without this, the INSERT below was
    // silently failing with 23502 / 42501 — the wizard would
    // no-op with no feedback.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      throw new Error('You are not signed in.');
    }
    if (!accountId) {
      throw new Error('Your profile is not linked to an account.');
    }

    setProgress(5);
    const contacts = await resolveAudience(payload.audience);
    if (contacts.length === 0) {
      throw new Error('No contacts found for this audience.');
    }

    setProgress(10);
    const { data: broadcast, error: broadcastError } = await supabase
      .from('broadcasts')
      .insert({
        user_id: user.id,
        account_id: accountId,
        name: payload.name,
        description: payload.description?.trim() || null,
        template_name: payload.template.name,
        template_language: payload.template.language ?? 'en_US',
        template_variables: payload.variables,
        header_media_url: payload.headerMediaUrl?.trim() || null,
        audience_filter: {
          type: payload.audience.type,
          tagIds: payload.audience.tagIds,
          matchAll: payload.audience.matchAll,
          customFields:
            payload.audience.customFields ??
            (payload.audience.customField ? [payload.audience.customField] : undefined),
          excludeTagIds: payload.audience.excludeTagIds,
          contactIds: payload.audience.contactIds,
          segmentId: payload.audience.segmentId,
          pipelineStageId: payload.audience.pipelineStageId,
        },
        status,
        total_recipients: contacts.length,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      })
      .select()
      .single();

    if (broadcastError || !broadcast) {
      throw new Error(
        `Failed to create campaign: ${broadcastError?.message ?? 'unknown error'}`,
      );
    }

    setProgress(20);
    const recipientRows = contacts.map((contact) => ({
      broadcast_id: broadcast.id,
      contact_id: contact.id,
      status: 'pending' as const,
    }));

    for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
      const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
      const { error: recipientError } = await supabase
        .from('broadcast_recipients')
        .upsert(batch, { onConflict: 'broadcast_id,contact_id', ignoreDuplicates: true });
      if (recipientError) {
        // Previous impl logged and marched on — the campaign then ran
        // with an incomplete recipient set, so webhook status updates
        // couldn't find some rows and the aggregate counts drifted.
        // Flip the campaign to failed so the user sees the problem
        // immediately, then throw to abort.
        await supabase
          .from('broadcasts')
          .update({ status: 'failed', failed_count: contacts.length })
          .eq('id', broadcast.id);
        throw new Error(
          `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${recipientError.message}`,
        );
      }
    }

    return { broadcastId: broadcast.id as string, recipientCount: contacts.length };
  }

  /**
   * Send every `pending` recipient of `broadcastId`. Shared by the
   * initial "Send Now" path (right after materializeCampaign) and
   * `startCampaignSending` (a 'ready' campaign, or resuming a
   * 'sending' one after an interruption) — in both cases it only ever
   * touches rows still `pending`, so it's safe to call more than once.
   * `progressRange` lets the two callers map onto different visible
   * progress spans (the create flow already spent 0-30 on
   * resolve+insert; a standalone resume starts fresh at 0-100).
   */
  async function sendPendingRecipients(
    supabase: ReturnType<typeof createClient>,
    broadcast: {
      id: string;
      template_name: string;
      template_language: string;
      template_variables: Record<string, VariableMapping> | null;
      header_media_url: string | null;
    },
    progressRange: [number, number] = [30, 95],
  ): Promise<{ failedCount: number; totalRecipients: number }> {
    const { data: recipients, error: recipientsFetchError } = await supabase
      .from('broadcast_recipients')
      .select('*, contact:contacts(*)')
      .eq('broadcast_id', broadcast.id)
      .eq('status', 'pending');

    if (recipientsFetchError || !recipients) {
      throw new Error('Failed to fetch campaign recipients');
    }
    if (recipients.length === 0) {
      return { failedCount: 0, totalRecipients: 0 };
    }

    const contactIds = recipients
      .map((r) => r.contact?.id)
      .filter((id): id is string => Boolean(id));
    const customValueIndex = await fetchCustomValueIndex(supabase, contactIds);

    // Media-header templates (image/video/document) require a media
    // URL on every send — read the template fresh so this works
    // whether we're mid-wizard (a full MessageTemplate is on hand) or
    // resuming a saved campaign (only template_name/language persist).
    const { data: templateRow } = await supabase
      .from('message_templates')
      .select('header_type')
      .eq('name', broadcast.template_name)
      .eq('language', broadcast.template_language)
      .maybeSingle();
    const headerType = templateRow?.header_type as string | undefined;
    const isMediaHeader =
      headerType === 'image' || headerType === 'video' || headerType === 'document';
    const headerMediaUrl = broadcast.header_media_url?.trim();
    const messageParams =
      isMediaHeader && headerMediaUrl ? { headerMediaUrl } : undefined;

    const variables = broadcast.template_variables ?? {};

    let failedCount = 0;
    const totalRecipients = recipients.length;
    const [rangeStart, rangeEnd] = progressRange;

    for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
      const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

      const apiRecipients = batch
        .filter((r) => r.contact?.phone)
        .map((r) => ({
          phone: r.contact!.phone as string,
          params: r.contact
            ? resolveVariables(variables, r.contact, customValueIndex.get(r.contact.id))
            : [],
          ...(messageParams ? { messageParams } : {}),
        }));

      if (apiRecipients.length === 0) continue;

      try {
        const res = await fetch('/api/whatsapp/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipients: apiRecipients,
            template_name: broadcast.template_name,
            template_language: broadcast.template_language,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Campaign send request failed');
        }

        const resultsByPhone = new Map<string, BroadcastApiResult>();
        for (const r of (data.results ?? []) as BroadcastApiResult[]) {
          resultsByPhone.set(r.phone, r);
        }

        for (const recipient of batch) {
          const phone = recipient.contact?.phone;
          const result = phone ? resultsByPhone.get(phone) : undefined;

          if (!result) {
            failedCount++;
            await supabase
              .from('broadcast_recipients')
              .update({ status: 'failed', error_message: 'No phone number on contact' })
              .eq('id', recipient.id);
            continue;
          }

          if (result.status === 'sent') {
            await supabase
              .from('broadcast_recipients')
              .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                whatsapp_message_id: result.whatsapp_message_id ?? null,
                error_message: null,
              })
              .eq('id', recipient.id);
          } else {
            failedCount++;
            await supabase
              .from('broadcast_recipients')
              .update({ status: 'failed', error_message: result.error ?? 'Unknown error' })
              .eq('id', recipient.id);
          }
        }
      } catch (err) {
        for (const recipient of batch) {
          failedCount++;
          await supabase
            .from('broadcast_recipients')
            .update({
              status: 'failed',
              error_message: err instanceof Error ? err.message : 'Unknown error',
            })
            .eq('id', recipient.id);
        }
      }

      const progressPct =
        rangeStart + Math.round(((i + batch.length) / totalRecipients) * (rangeEnd - rangeStart));
      setProgress(progressPct);

      if (i + SEND_BATCH_SIZE < recipients.length) {
        await sleep(SEND_BATCH_DELAY_MS);
      }
    }

    return { failedCount, totalRecipients };
  }

  /**
   * Decide the terminal status from the DB's own count, not just this
   * run's outcome — a resume call that finds nothing `pending` still
   * needs to flip 'sending' → 'sent'/'failed' (a prior run could have
   * finished sending but been interrupted before this last update).
   */
  async function finalizeCampaignStatus(
    supabase: ReturnType<typeof createClient>,
    broadcastId: string,
  ): Promise<void> {
    setProgress(95);
    const { count: pendingCount } = await supabase
      .from('broadcast_recipients')
      .select('*', { count: 'exact', head: true })
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending');
    if ((pendingCount ?? 0) > 0) return; // still has work left — leave 'sending'

    const { data: broadcast } = await supabase
      .from('broadcasts')
      .select('total_recipients, failed_count')
      .eq('id', broadcastId)
      .single();
    if (!broadcast) return;
    const finalStatus = broadcast.failed_count >= broadcast.total_recipients ? 'failed' : 'sent';
    await supabase.from('broadcasts').update({ status: finalStatus }).eq('id', broadcastId);
  }

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);
    const supabase = createClient();
    try {
      const { broadcastId } = await materializeCampaign(payload, 'sending');
      setProgress(30);
      await sendPendingRecipients(
        supabase,
        {
          id: broadcastId,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          template_variables: payload.variables,
          header_media_url: payload.headerMediaUrl?.trim() || null,
        },
        [30, 95],
      );
      await finalizeCampaignStatus(supabase, broadcastId);
      setProgress(100);
      return broadcastId;
    } finally {
      setIsProcessing(false);
    }
  }

  /** "Salvar como pronta para envio" — materializes recipients, doesn't send. */
  async function saveCampaignReady(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);
    try {
      const { broadcastId } = await materializeCampaign(payload, 'ready');
      setProgress(100);
      return broadcastId;
    } finally {
      setIsProcessing(false);
    }
  }

  /**
   * "Iniciar envio" (campaign is 'ready') or "Continuar envio" (a
   * 'sending' campaign got interrupted, e.g. the tab closed mid-send) —
   * same operation either way: send whatever is still `pending`.
   */
  async function startCampaignSending(campaignId: string): Promise<void> {
    setIsProcessing(true);
    setProgress(0);
    const supabase = createClient();
    try {
      const { data: broadcast, error } = await supabase
        .from('broadcasts')
        .select('id, status, template_name, template_language, template_variables, header_media_url')
        .eq('id', campaignId)
        .single();
      if (error || !broadcast) {
        throw new Error('Campaign not found');
      }
      if (broadcast.status === 'sent' || broadcast.status === 'cancelled') {
        throw new Error(`Campaign is already ${broadcast.status} — nothing to send.`);
      }

      if (broadcast.status !== 'sending') {
        await supabase.from('broadcasts').update({ status: 'sending' }).eq('id', campaignId);
      }

      await sendPendingRecipients(supabase, {
        id: broadcast.id,
        template_name: broadcast.template_name,
        template_language: broadcast.template_language,
        template_variables: broadcast.template_variables,
        header_media_url: broadcast.header_media_url,
      });
      await finalizeCampaignStatus(supabase, campaignId);
      setProgress(100);
    } finally {
      setIsProcessing(false);
    }
  }

  return {
    createAndSendBroadcast,
    saveCampaignReady,
    startCampaignSending,
    previewAudience,
    isProcessing,
    progress,
  };
}
