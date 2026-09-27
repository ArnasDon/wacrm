// ============================================================
// Connecting a WhatsApp channel — the Meta checks shared by the
// channel routes (verify, create, refresh).
//
// Every failure resolves to a ready NextResponse shaped
// `{ error, field?, meta? }`: `error` is the actionable text, `field`
// the form input to fix, `meta` the code / fbtrace_id a user can quote
// to Meta support (issue #505). 400 = fix it on the form, 502 = Meta
// has to change something.
// ============================================================

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getPhoneNumberDetails,
  getWabaName,
  listWabaPhoneNumbers,
} from '@/lib/whatsapp/meta-api';
import {
  explainMetaError,
  metaErrorPayload,
  type MetaConnectStep,
  type MetaErrorContext,
} from '@/lib/whatsapp/meta-error-explain';
import {
  describeWabaPhoneMismatch,
  isNumericMetaId,
  phoneNumberBelongsToWaba,
} from '@/lib/whatsapp/waba-pairing';
import { encrypt } from '@/lib/whatsapp/encryption';

export interface ChannelCredentials {
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
}

/** What Meta says about a number — cached on the channel row. */
export interface ChannelSnapshot {
  display_phone_number: string | null;
  verified_name: string | null;
  waba_name: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  meta_status: string | null;
  code_verification_status: string | null;
  name_status: string | null;
  account_mode: string | null;
  is_official_business_account: boolean | null;
  country_code: string | null;
  country_dial_code: string | null;
  throughput_level: string | null;
  /** The callback Meta actually uses for this number (overrides first). */
  webhook_url: string | null;
}

export function metaFailure(
  err: unknown,
  step: MetaConnectStep,
  ctx: MetaErrorContext
): NextResponse {
  const explained = explainMetaError(err, step, ctx);
  console.error(`[whatsapp/channels] Meta ${step} failed:`, explained.metaMessage, {
    code: explained.code,
    subcode: explained.subcode,
    fbtrace_id: explained.fbtraceId,
  });
  return NextResponse.json(
    { error: explained.summary, field: explained.field, meta: metaErrorPayload(explained) },
    { status: explained.httpStatus }
  );
}

function fieldError(error: string, field: string, status = 400): NextResponse {
  return NextResponse.json({ error, field }, { status });
}

/**
 * Validate the raw form input. Returns the trimmed credentials, or a
 * 400 naming the field — catches the classic paste mistakes (the +phone
 * number, a display name, a URL) before Meta answers "(#100)
 * Unsupported get request".
 */
export function parseCredentials(
  body: Record<string, unknown>
): ChannelCredentials | NextResponse {
  const wabaId = String(body.waba_id ?? '').trim();
  const phoneNumberId = String(body.phone_number_id ?? '').trim();
  const accessToken = String(body.access_token ?? '').trim();

  if (!wabaId) return fieldError('WABA ID is required.', 'waba_id');
  if (!isNumericMetaId(wabaId)) {
    return fieldError(
      'WABA ID must contain only digits — copy it from Meta → WhatsApp → API Setup.',
      'waba_id'
    );
  }
  if (!phoneNumberId) return fieldError('Phone Number ID is required.', 'phone_number_id');
  if (!isNumericMetaId(phoneNumberId)) {
    return fieldError(
      'Phone Number ID must contain only digits — it is the numeric id shown under Meta → WhatsApp → API Setup, not the phone number itself.',
      'phone_number_id'
    );
  }
  if (!accessToken) return fieldError('Access token is required.', 'access_token');

  return { wabaId, phoneNumberId, accessToken };
}

/**
 * Ask Meta about the number: it must be readable with the token and
 * listed under the WABA. Returns the snapshot shown on the channel row.
 */
export async function inspectChannel(
  creds: ChannelCredentials
): Promise<{ snapshot: ChannelSnapshot } | { response: NextResponse }> {
  const ctx: MetaErrorContext = { phoneNumberId: creds.phoneNumberId, wabaId: creds.wabaId };

  let details;
  try {
    details = await getPhoneNumberDetails({
      phoneNumberId: creds.phoneNumberId,
      accessToken: creds.accessToken,
    });
  } catch (err) {
    return { response: metaFailure(err, 'verify_number', ctx) };
  }

  // A foreign-but-valid WABA ID used to save fine and subscribe the
  // *wrong* account, surfacing days later as a webhook that never fires.
  let wabaNumbers;
  try {
    wabaNumbers = await listWabaPhoneNumbers({
      wabaId: creds.wabaId,
      accessToken: creds.accessToken,
    });
  } catch (err) {
    return { response: metaFailure(err, 'waba_phone_numbers', ctx) };
  }
  if (!phoneNumberBelongsToWaba(wabaNumbers, creds.phoneNumberId)) {
    return {
      response: fieldError(
        describeWabaPhoneMismatch(wabaNumbers, creds.phoneNumberId, creds.wabaId),
        'waba_id'
      ),
    };
  }

  const wabaName = await getWabaName({ wabaId: creds.wabaId, accessToken: creds.accessToken });

  return {
    snapshot: {
      display_phone_number: details.display_phone_number ?? null,
      verified_name: details.verified_name ?? null,
      waba_name: wabaName,
      quality_rating: details.quality_rating ?? null,
      messaging_limit_tier:
        details.whatsapp_business_manager_messaging_limit ?? details.messaging_limit_tier ?? null,
      meta_status: details.status ?? null,
      code_verification_status: details.code_verification_status ?? null,
      name_status: details.name_status ?? null,
      account_mode: details.account_mode ?? null,
      is_official_business_account: details.is_official_business_account ?? null,
      country_code: details.country_code ?? null,
      country_dial_code: details.country_dial_code ?? null,
      throughput_level: details.throughput?.level ?? null,
      webhook_url:
        details.webhook_configuration?.phone_number ??
        details.webhook_configuration?.whatsapp_business_account ??
        details.webhook_configuration?.application ??
        null,
    },
  };
}

/**
 * 409 when the number is already a channel — in this workspace or
 * another. UNIQUE(phone_number_id) would reject the insert anyway, but
 * this says why. Needs a service-role client: under RLS the caller
 * can't see other accounts' rows.
 */
export async function phoneNumberConflict(
  admin: SupabaseClient,
  accountId: string,
  phoneNumberId: string
): Promise<NextResponse | null> {
  const { data, error } = await admin
    .from('whatsapp_config')
    .select('account_id, name')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();
  if (error) {
    console.error('[whatsapp/channels] phone_number_id ownership check failed:', error);
    return NextResponse.json({ error: 'Failed to validate the channel.' }, { status: 500 });
  }
  if (!data) return null;
  if (data.account_id === accountId) {
    return fieldError(
      `This phone number is already connected here${data.name ? ` as "${data.name}"` : ''}.`,
      'phone_number_id',
      409
    );
  }
  return fieldError(
    'This phone number is already connected to another workspace on this instance.',
    'phone_number_id',
    409
  );
}

/**
 * The encrypted webhook verify token for a new channel. Meta's webhook
 * handshake accepts any account's token, so every channel of an account
 * shares one — reuse an existing channel's, else mint a new one.
 */
export async function verifyTokenForNewChannel(
  db: SupabaseClient,
  accountId: string
): Promise<string> {
  const { data } = await db
    .from('whatsapp_config')
    .select('verify_token')
    .eq('account_id', accountId)
    .not('verify_token', 'is', null)
    .order('created_at', { ascending: true })
    .limit(1);
  const existing = data?.[0]?.verify_token as string | undefined;
  if (existing) return existing;
  return encrypt(`wacrm_${crypto.randomBytes(12).toString('hex')}`);
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function parseColor(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : null;
}

export const CHANNEL_NAME_MAX = 60;
