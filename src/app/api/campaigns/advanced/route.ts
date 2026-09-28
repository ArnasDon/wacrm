// ============================================================
// POST /api/campaigns/advanced — create an advanced campaign.
//
// Body:
//   name, channel_ids[], templates[{name, language}] (priority order),
//   phone_column, name_column?, country_code?, mappings{templateKey →
//   TemplateMapping}, speed, schedule {mode: 'now'|'later', at?},
//   rows[] (CSV rows as {column: value})
//
// Validates the plan against the account's channels and approved
// templates, turns every CSV phone into a contact, persists the
// campaign + its pending recipients (each carrying only the CSV cells
// its variables need), then either starts the first runner pass in
// `after()` ("send now") or leaves it 'scheduled' for the scheduler.
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
  MAX_CHANNELS,
  MAX_ROWS,
  MAX_TEMPLATES,
  SPEED_MAX,
  SPEED_MIN,
  normalizeCsvPhone,
  referencedColumns,
  templateKey,
  templateSlots,
  type AdvancedCampaignConfig,
  type CampaignTemplateRef,
  type TemplateMapping,
  type ValueSource,
} from '@/lib/campaigns/advanced';
import { upsertContactsByPhone } from '@/lib/campaigns/contacts';
import { driveCampaign } from '@/lib/campaigns/advanced-scheduler';
import type { MessageTemplate } from '@/types';

export const maxDuration = 300;

const bad = (error: string, status = 400) =>
  NextResponse.json({ error }, { status });

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
    const channelIds: string[] = Array.isArray(body.channel_ids)
      ? [
          ...new Set<string>(
            body.channel_ids.filter(
              (x: unknown): x is string => typeof x === 'string'
            )
          ),
        ]
      : [];
    const templates: CampaignTemplateRef[] = Array.isArray(body.templates)
      ? body.templates
          .filter(
            (t: unknown): t is CampaignTemplateRef =>
              !!t &&
              typeof (t as CampaignTemplateRef).name === 'string' &&
              typeof (t as CampaignTemplateRef).language === 'string'
          )
          .map((t: CampaignTemplateRef) => ({
            name: t.name,
            language: t.language,
          }))
      : [];
    const phoneColumn =
      typeof body.phone_column === 'string' ? body.phone_column : '';
    const nameColumn =
      typeof body.name_column === 'string' && body.name_column
        ? body.name_column
        : null;
    const countryCode =
      typeof body.country_code === 'string' ? body.country_code : '';
    const mappings: Record<string, TemplateMapping> =
      body.mappings && typeof body.mappings === 'object' ? body.mappings : {};
    const speed = Math.round(Number(body.speed));
    const rows: Record<string, string>[] = Array.isArray(body.rows)
      ? body.rows
      : [];
    const scheduleMode = body.schedule?.mode === 'later' ? 'later' : 'now';
    const scheduledAt =
      scheduleMode === 'later' ? new Date(body.schedule?.at) : null;

    if (!name) return bad('Give the campaign a name');
    if (channelIds.length === 0) return bad('Select at least one channel');
    if (channelIds.length > MAX_CHANNELS)
      return bad(`At most ${MAX_CHANNELS} channels per campaign`);
    if (templates.length === 0) return bad('Select at least one template');
    if (templates.length > MAX_TEMPLATES)
      return bad(`At most ${MAX_TEMPLATES} templates per campaign`);
    if (!phoneColumn) return bad('Choose the column that holds phone numbers');
    if (!Number.isFinite(speed) || speed < SPEED_MIN || speed > SPEED_MAX) {
      return bad(
        `Speed must be between ${SPEED_MIN} and ${SPEED_MAX} messages per second`
      );
    }
    if (rows.length === 0) return bad('The CSV has no rows');
    if (rows.length > MAX_ROWS)
      return bad(
        `A campaign is capped at ${MAX_ROWS.toLocaleString('en')} rows`
      );
    if (
      scheduledAt &&
      (Number.isNaN(scheduledAt.getTime()) ||
        scheduledAt.getTime() < Date.now() - 60_000)
    ) {
      return bad('Pick a schedule time in the future');
    }

    const db = supabaseAdmin();

    // ── Channels ───────────────────────────────────────────────────
    const { data: channels } = await db
      .from('whatsapp_config')
      .select('id, name, verified_name, display_phone_number, waba_id')
      .eq('account_id', accountId)
      .in('id', channelIds);
    if (!channels || channels.length !== channelIds.length)
      return bad('One of the selected channels no longer exists');

    // ── Templates: every channel needs at least one approved one ──
    const { data: templateRows } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .in('name', [...new Set(templates.map((t) => t.name))]);
    const approved = ((templateRows ?? []) as MessageTemplate[]).filter(
      (t) => t.status === 'APPROVED'
    );
    const rowFor = (ref: CampaignTemplateRef, wabaId?: string | null) =>
      approved.find(
        (t) =>
          t.name === ref.name &&
          (t.language ?? 'en_US') === ref.language &&
          (wabaId === undefined || t.waba_id === wabaId || !t.waba_id)
      );

    for (const ref of templates) {
      if (!rowFor(ref))
        return bad(`Template "${ref.name}" (${ref.language}) is not approved`);
    }
    for (const ch of channels) {
      if (!templates.some((ref) => rowFor(ref, ch.waba_id))) {
        const label = ch.name || ch.verified_name || ch.display_phone_number;
        return bad(
          `None of the selected templates is approved on channel "${label}"`
        );
      }
    }

    // ── Mappings: every variable of every template must be filled ─
    const headers = new Set(Object.keys(rows[0] ?? {}));
    if (!headers.has(phoneColumn))
      return bad(`Column "${phoneColumn}" is not in the CSV`);
    const sourceOk = (s: ValueSource | undefined) =>
      !!s &&
      (s.type === 'static' ? s.value.trim() !== '' : headers.has(s.value));
    const cleanMappings: Record<string, TemplateMapping> = {};
    for (const ref of templates) {
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
          return bad(`Template "${ref.name}": map the URL of button ${i + 1}`);
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

    const config: AdvancedCampaignConfig = {
      version: 1,
      channel_ids: channelIds,
      templates,
      phone_column: phoneColumn,
      name_column: nameColumn,
      mappings: cleanMappings,
      speed,
      exhausted: {},
    };

    // ── Rows → recipients ─────────────────────────────────────────
    const keep = referencedColumns(config);
    const seen = new Set<string>();
    let invalid = 0;
    let duplicates = 0;
    const planned: {
      phone: string;
      name: string | null;
      data: Record<string, string>;
    }[] = [];
    for (const r of rows) {
      const phone = normalizeCsvPhone(
        String(r?.[phoneColumn] ?? ''),
        countryCode
      );
      if (!phone) {
        invalid++;
        continue;
      }
      if (seen.has(phone)) {
        duplicates++;
        continue;
      }
      seen.add(phone);
      const data: Record<string, string> = { __phone: phone };
      for (const c of keep) data[c] = String(r?.[c] ?? '');
      planned.push({
        phone,
        name: nameColumn ? String(r?.[nameColumn] ?? '') || null : null,
        data,
      });
    }
    if (planned.length === 0) return bad('No row has a valid phone number');

    const contactIds = await upsertContactsByPhone(
      db,
      accountId,
      userId,
      planned
    );

    const { data: broadcast, error: bcError } = await db
      .from('broadcasts')
      .insert({
        user_id: userId,
        account_id: accountId,
        name,
        kind: 'advanced',
        config,
        template_name: templates[0].name,
        template_language: templates[0].language,
        audience_filter: {
          type: 'csv',
          rows: rows.length,
          invalid,
          duplicates,
        },
        status: scheduleMode === 'later' ? 'scheduled' : 'sending',
        scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
        total_recipients: planned.length,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      })
      .select('id')
      .single();
    if (bcError || !broadcast) {
      console.error('[campaigns/advanced] insert failed:', bcError?.message);
      return bad('Failed to create the campaign', 500);
    }

    const recipients = planned
      .filter((p) => contactIds.has(p.phone))
      .map((p) => ({
        broadcast_id: broadcast.id,
        contact_id: contactIds.get(p.phone)!,
        status: 'pending',
        row_data: p.data,
      }));
    for (let i = 0; i < recipients.length; i += 1000) {
      const { error } = await db
        .from('broadcast_recipients')
        .insert(recipients.slice(i, i + 1000));
      if (error) {
        console.error(
          '[campaigns/advanced] recipient insert failed:',
          error.message
        );
        await db.from('broadcasts').delete().eq('id', broadcast.id);
        return bad('Failed to save the recipients', 500);
      }
    }
    if (recipients.length !== planned.length) {
      await db
        .from('broadcasts')
        .update({ total_recipients: recipients.length })
        .eq('id', broadcast.id);
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
        invalid,
        duplicates,
        status: scheduleMode === 'later' ? 'scheduled' : 'sending',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in advanced campaign POST:', error);
    return toErrorResponse(error);
  }
}
