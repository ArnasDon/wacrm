// ============================================================
// POST /api/campaigns/advanced — launch (or schedule) a campaign built
// in the campaign wizard (standard and advanced modes alike).
//
// Body:
//   name, mode ('standard' | 'advanced'),
//   channel_ids[], channel_templates { channelId: [{name, language}] },
//   distribution ('channel' | 'template' | 'matrix'), max_contacts (0 = all),
//   speed (msg/s per channel),
//   audience { source: 'all'|'tags'|'segment'|'manual'|'csv', tagIds?,
//              tagMatch?, segment?, excludeTagIds?, rows?, phoneColumn?,
//              nameColumn? },
//   mappings { templateKey: TemplateMapping },
//   schedule { mode: 'now' | 'later', at? }, draft_id?
//
// Validates everything against the account's channels and approved
// templates, resolves the audience (lib/campaigns/audience), splits it
// over channel × template pairs (lib/campaigns/distribution), stamps
// each recipient with its planned pair, then starts sending in `after()`
// or leaves it scheduled. The server does all sending.
// ============================================================

import { NextResponse, after } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  CAMPAIGN_INTERVAL_SECONDS,
  MAX_CHANNELS,
  MAX_ROWS,
  MAX_TEMPLATES,
  ROW_CHANNEL,
  ROW_TEMPLATE,
  SPEED_MAX,
  SPEED_MIN,
  referencedColumns,
  templateKey,
  templateSlots,
  type AdvancedCampaignConfig,
  type CampaignTemplateRef,
  type TemplateMapping,
  type ValueSource,
} from '@/lib/campaigns/advanced';
import {
  resolveAudience,
  CONTACT_FIELDS,
  type AudienceSpec,
} from '@/lib/campaigns/audience';
import {
  assignPairs,
  buildPairs,
  planDistribution,
  type DistributionMode,
} from '@/lib/campaigns/distribution';
import { upsertContactsByPhone } from '@/lib/campaigns/contacts';
import { driveCampaign } from '@/lib/campaigns/advanced-scheduler';
import type { MessageTemplate } from '@/types';

export const maxDuration = 300;

const bad = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });
const isRef = (t: unknown): t is CampaignTemplateRef =>
  !!t &&
  typeof (t as CampaignTemplateRef).name === 'string' &&
  typeof (t as CampaignTemplateRef).language === 'string';

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(
      `campaign-advanced:${userId}`,
      RATE_LIMITS.broadcast
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return bad('Invalid JSON body');

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const mode: 'standard' | 'advanced' =
      body.mode === 'standard' ? 'standard' : 'advanced';
    const channelIds: string[] = Array.isArray(body.channel_ids)
      ? [
          ...new Set<string>(
            body.channel_ids.filter(
              (x: unknown): x is string => typeof x === 'string'
            )
          ),
        ]
      : [];
    const rawCt =
      body.channel_templates && typeof body.channel_templates === 'object'
        ? body.channel_templates
        : {};
    const channelTemplates: Record<string, CampaignTemplateRef[]> = {};
    for (const id of channelIds) {
      const list = Array.isArray(rawCt[id]) ? rawCt[id].filter(isRef) : [];
      const seen = new Set<string>();
      channelTemplates[id] = list
        .map((t: CampaignTemplateRef) => ({
          name: t.name,
          language: t.language,
        }))
        .filter(
          (t: CampaignTemplateRef) =>
            !seen.has(templateKey(t)) && !!seen.add(templateKey(t))
        );
    }
    const distribution: DistributionMode = [
      'channel',
      'template',
      'matrix',
    ].includes(body.distribution)
      ? body.distribution
      : 'channel';
    const maxContacts = Math.max(0, Math.floor(Number(body.max_contacts) || 0));
    const speed = Math.round(Number(body.speed));
    const mappings: Record<string, TemplateMapping> =
      body.mappings && typeof body.mappings === 'object' ? body.mappings : {};
    const scheduleMode = body.schedule?.mode === 'later' ? 'later' : 'now';
    const scheduledAt =
      scheduleMode === 'later' ? new Date(body.schedule?.at) : null;
    const draftId = typeof body.draft_id === 'string' ? body.draft_id : null;
    // Advanced delivery settings (all off unless ticked).
    const d =
      body.delivery && typeof body.delivery === 'object' ? body.delivery : {};
    const delivery = {
      interval_seconds: d.interval === true ? CAMPAIGN_INTERVAL_SECONDS : 0,
      pause_on_quality_hold: d.pauseOnQualityHold === true,
      stop_on_meta_error: d.stopOnMetaError === true,
    };

    const a = body.audience ?? {};
    const source = ['all', 'tags', 'segment', 'manual', 'csv'].includes(
      a.source
    )
      ? a.source
      : null;
    if (!name) return bad('Give the campaign a name');
    if (channelIds.length === 0) return bad('Select at least one channel');
    if (channelIds.length > MAX_CHANNELS)
      return bad(`At most ${MAX_CHANNELS} channels per campaign`);
    if (mode === 'standard' && channelIds.length !== 1)
      return bad('A standard campaign sends from one channel');
    if (!source) return bad('Choose an audience');
    if (!Number.isFinite(speed) || speed < SPEED_MIN || speed > SPEED_MAX) {
      return bad(
        `Speed must be between ${SPEED_MIN} and ${SPEED_MAX} messages per second`
      );
    }
    if (
      scheduledAt &&
      (Number.isNaN(scheduledAt.getTime()) ||
        scheduledAt.getTime() < Date.now() - 60_000)
    ) {
      return bad('Pick a schedule time in the future');
    }
    const union: CampaignTemplateRef[] = [];
    for (const id of channelIds) {
      if (channelTemplates[id].length === 0)
        return bad('Choose at least one template for every channel');
      for (const t of channelTemplates[id]) {
        if (!union.some((u) => templateKey(u) === templateKey(t)))
          union.push(t);
      }
    }
    if (union.length > MAX_TEMPLATES)
      return bad(`At most ${MAX_TEMPLATES} different templates per campaign`);
    if (mode === 'standard' && union.length !== 1)
      return bad('A standard campaign sends one template');

    const db = supabaseAdmin();

    // ── Channels + templates (approved, on each channel's WABA) ────
    const { data: channels } = await db
      .from('whatsapp_config')
      .select('id, name, verified_name, display_phone_number, waba_id, status')
      .eq('account_id', accountId)
      .in('id', channelIds);
    if (!channels || channels.length !== channelIds.length)
      return bad('One of the selected channels no longer exists');

    const { data: templateRows } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .in('name', [...new Set(union.map((t) => t.name))]);
    const approved = ((templateRows ?? []) as MessageTemplate[]).filter(
      (t) => t.status === 'APPROVED'
    );
    const rowFor = (ref: CampaignTemplateRef, wabaId?: string | null) =>
      approved.find(
        (t) =>
          t.name === ref.name &&
          (t.language ?? 'en_US') === ref.language &&
          (wabaId === undefined || !t.waba_id || t.waba_id === wabaId)
      );
    for (const ch of channels) {
      const label = ch.name || ch.verified_name || ch.display_phone_number;
      for (const ref of channelTemplates[ch.id]) {
        if (!rowFor(ref, ch.waba_id))
          return bad(
            `Template "${ref.name}" isn't approved on channel "${label}"`
          );
      }
    }

    // ── Audience ──────────────────────────────────────────────────
    const rows: Record<string, string>[] = Array.isArray(a.rows) ? a.rows : [];
    if ((source === 'csv' || source === 'manual') && rows.length === 0)
      return bad('The audience has no rows');
    if (rows.length > MAX_ROWS)
      return bad(
        `A campaign is capped at ${MAX_ROWS.toLocaleString('en')} rows`
      );
    const phoneColumn =
      typeof a.phoneColumn === 'string' ? a.phoneColumn : 'phone';
    const nameColumn =
      typeof a.nameColumn === 'string' && a.nameColumn ? a.nameColumn : null;

    // ── Variables: every template's slots must be filled ──────────
    const fromRows = source === 'csv' || source === 'manual';
    const available = new Set(
      fromRows ? Object.keys(rows[0] ?? {}) : [...CONTACT_FIELDS]
    );
    const sourceOk = (s: ValueSource | undefined) =>
      !!s &&
      (s.type === 'static'
        ? s.value.trim() !== ''
        : available.has(s.value) || (!fromRows && s.value.startsWith('cf:')));
    const cleanMappings: Record<string, TemplateMapping> = {};
    for (const ref of union) {
      const key = templateKey(ref);
      const slots = templateSlots(rowFor(ref)!);
      const m: TemplateMapping = mappings[key] ?? { body: {} };
      for (const n of slots.body) {
        if (!sourceOk(m.body?.[String(n)]))
          return bad(`Template "${ref.name}": map variable {{${n}}}`);
      }
      if (slots.headerText && !sourceOk(m.header_text))
        return bad(`Template "${ref.name}": map the header variable`);
      for (const i of slots.urlButtons) {
        if (!sourceOk(m.buttons?.[String(i)]))
          return bad(`Template "${ref.name}": map the link of button ${i + 1}`);
      }
      cleanMappings[key] = {
        body: Object.fromEntries(
          slots.body.map((n) => [String(n), m.body[String(n)]])
        ),
        ...(slots.headerText ? { header_text: m.header_text } : {}),
        ...(slots.headerMedia && m.header_media_url?.trim()
          ? { header_media_url: m.header_media_url.trim() }
          : {}),
        ...(slots.urlButtons.length
          ? {
              buttons: Object.fromEntries(
                slots.urlButtons.map((i) => [String(i), m.buttons![String(i)]])
              ),
            }
          : {}),
      };
    }

    const keep = referencedColumns({
      mappings: cleanMappings,
      name_column: fromRows ? nameColumn : null,
    });
    const spec: AudienceSpec = fromRows
      ? {
          source: 'rows',
          rows,
          phoneColumn,
          nameColumn,
          excludeTagIds: a.excludeTagIds,
        }
      : {
          source:
            source === 'tags'
              ? 'tags'
              : source === 'segment'
                ? 'segment'
                : 'all',
          tagIds: Array.isArray(a.tagIds) ? a.tagIds : [],
          tagMatch: a.tagMatch === 'all' ? 'all' : 'any',
          segment: a.segment,
          excludeTagIds: Array.isArray(a.excludeTagIds) ? a.excludeTagIds : [],
        };
    const audience = await resolveAudience(db, accountId, spec, keep);
    let recipients = audience.recipients;
    if (maxContacts > 0) recipients = recipients.slice(0, maxContacts);
    if (recipients.length === 0)
      return bad('No one in this audience has a valid phone number');

    // Uploaded / pasted numbers become contacts (recipients FK contacts).
    const missing = recipients.filter((r) => !r.contactId);
    if (missing.length) {
      const ids = await upsertContactsByPhone(
        db,
        accountId,
        userId,
        missing.map((r) => ({ phone: r.phone, name: r.name }))
      );
      for (const r of missing) r.contactId = ids.get(r.phone) ?? null;
      recipients = recipients.filter((r) => r.contactId);
    }

    // ── Split over channel × template pairs ───────────────────────
    const pairs = buildPairs(channelIds, channelTemplates);
    const plan = assignPairs(
      planDistribution(pairs, distribution, recipients.length)
    );

    const config: AdvancedCampaignConfig = {
      version: 1,
      mode,
      channel_ids: channelIds,
      templates: union,
      channel_templates: channelTemplates,
      distribution,
      audience_source: source,
      phone_column: phoneColumn,
      name_column: fromRows ? nameColumn : null,
      mappings: cleanMappings,
      speed,
      delivery,
      exhausted: {},
    };

    const { data: broadcast, error: bcError } = await db
      .from('broadcasts')
      .insert({
        user_id: userId,
        account_id: accountId,
        name,
        kind: 'advanced',
        config,
        template_name: union[0].name,
        template_language: union[0].language,
        audience_filter: {
          type: source,
          total: audience.total,
          invalid: audience.invalid,
          duplicates: audience.duplicates,
          excluded: audience.excluded,
        },
        status: scheduleMode === 'later' ? 'scheduled' : 'sending',
        scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
        total_recipients: recipients.length,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      })
      .select('id')
      .single();
    if (bcError || !broadcast) {
      console.error('[campaigns] insert failed:', bcError?.message);
      return bad('Failed to create the campaign', 500);
    }

    const recipientRows = recipients.map((r, i) => ({
      broadcast_id: broadcast.id,
      contact_id: r.contactId!,
      status: 'pending',
      row_data: {
        ...r.data,
        __phone: r.phone,
        [ROW_CHANNEL]: plan[i].channelId,
        [ROW_TEMPLATE]: plan[i].key,
      },
    }));
    for (let i = 0; i < recipientRows.length; i += 1000) {
      const { error } = await db
        .from('broadcast_recipients')
        .insert(recipientRows.slice(i, i + 1000));
      if (error) {
        console.error('[campaigns] recipient insert failed:', error.message);
        await db.from('broadcasts').delete().eq('id', broadcast.id);
        return bad('Failed to save the recipients', 500);
      }
    }

    // Launched from a saved draft: the draft has become this campaign.
    if (draftId) {
      await db
        .from('broadcasts')
        .delete()
        .eq('id', draftId)
        .eq('account_id', accountId)
        .eq('status', 'draft');
    }

    if (scheduleMode === 'now') {
      after(async () => {
        await driveCampaign(db, broadcast.id);
      });
    }

    return NextResponse.json(
      {
        success: true,
        broadcast_id: broadcast.id,
        recipients: recipients.length,
        invalid: audience.invalid,
        duplicates: audience.duplicates,
        excluded: audience.excluded,
        status: scheduleMode === 'later' ? 'scheduled' : 'sending',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in campaign POST:', error);
    return toErrorResponse(error);
  }
}
