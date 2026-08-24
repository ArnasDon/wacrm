// ============================================================
// Shared deal logic for the public API (v1) deal endpoints.
//
// Kept out of the route files so `GET/POST /api/v1/deals` and
// `GET/PATCH/DELETE /api/v1/deals/{id}` share one serializer, one
// input parser, and one set of cross-reference checks (a deal's
// `pipeline_id`/`stage_id`/`contact_id`/`assigned_to` must all
// resolve inside the caller's own account — never trust a foreign id
// silently, and never leak whether it exists elsewhere).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { DEFAULT_CURRENCY } from '@/lib/currency';
import type { DealStatus } from '@/types';

export const DEAL_STATUSES: readonly DealStatus[] = ['open', 'won', 'lost'];

export interface ApiDeal {
  id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  assigned_to: string | null;
  title: string;
  value: number;
  currency: string;
  notes: string | null;
  expected_close_date: string | null;
  status: DealStatus;
  created_at: string;
  updated_at: string;
}

/** Thrown by the helpers below; routes map `.status`/`.message`. */
export class DealError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DealError';
    this.status = status;
  }
}

/** Flatten a `deals` row into the public deal shape. */
export function serializeDeal(row: Record<string, unknown>): ApiDeal {
  return {
    id: row.id as string,
    pipeline_id: row.pipeline_id as string,
    stage_id: row.stage_id as string,
    contact_id: (row.contact_id as string | null) ?? null,
    conversation_id: (row.conversation_id as string | null) ?? null,
    assigned_to: (row.assigned_to as string | null) ?? null,
    title: row.title as string,
    value: Number(row.value ?? 0),
    currency: (row.currency as string | null) ?? DEFAULT_CURRENCY,
    notes: (row.notes as string | null) ?? null,
    expected_close_date: (row.expected_close_date as string | null) ?? null,
    status: (row.status as DealStatus | null) ?? 'open',
    created_at: row.created_at as string,
    updated_at: (row.updated_at as string | null) ?? (row.created_at as string),
  };
}

/** Fetch + serialize a single deal scoped to the account, or null. */
export async function getDealById(
  db: SupabaseClient,
  accountId: string,
  dealId: string
): Promise<ApiDeal | null> {
  const { data, error } = await db
    .from('deals')
    .select('*')
    .eq('id', dealId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return serializeDeal(data as Record<string, unknown>);
}

const CURRENCY_RE = /^[A-Za-z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_LEN = 200;
const MAX_NOTES_LEN = 5000;

/**
 * Scalar deal fields a caller may set, independent of whether they
 * come from a create (all required-ones must be present) or a patch
 * (only present keys are touched).
 */
export interface DealWriteFields {
  title?: string;
  value?: number;
  currency?: string;
  contact_id?: string | null;
  assigned_to?: string | null;
  notes?: string | null;
  expected_close_date?: string | null;
  status?: DealStatus;
}

/**
 * Parse + type-check the scalar (non-reference) fields of a deal
 * write body. Pure — no I/O, so a bad type is rejected before any DB
 * round trip. `pipeline_id`/`stage_id` are handled separately (they
 * need a DB lookup to validate, see {@link assertPipelineAndStage}).
 *
 * On create (`requireTitle: true`) a missing/blank `title` is a 400.
 * On patch (`requireTitle: false`) fields are only included in the
 * result when the caller's body actually has the key — omitted means
 * "leave alone", matching the contacts `PATCH` convention.
 */
export function parseDealFields(
  body: Record<string, unknown>,
  opts: { requireTitle: boolean }
): DealWriteFields {
  const out: DealWriteFields = {};

  if ('title' in body || opts.requireTitle) {
    const raw = body.title;
    const title = typeof raw === 'string' ? raw.trim() : '';
    if (!title) {
      throw new DealError("'title' is required", 400);
    }
    if (title.length > MAX_TITLE_LEN) {
      throw new DealError(
        `'title' must be ${MAX_TITLE_LEN} characters or fewer`,
        400
      );
    }
    out.title = title;
  }

  if ('value' in body) {
    const raw = body.value;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      throw new DealError("'value' must be a non-negative number", 400);
    }
    out.value = raw;
  }

  if ('currency' in body) {
    const raw = body.currency;
    if (typeof raw !== 'string' || !CURRENCY_RE.test(raw)) {
      throw new DealError(
        "'currency' must be a 3-letter ISO-4217 code (e.g. \"USD\")",
        400
      );
    }
    out.currency = raw.toUpperCase();
  }

  if ('contact_id' in body) {
    const raw = body.contact_id;
    if (raw !== null && typeof raw !== 'string') {
      throw new DealError("'contact_id' must be a string or null", 400);
    }
    out.contact_id = raw;
  }

  if ('assigned_to' in body) {
    const raw = body.assigned_to;
    if (raw !== null && typeof raw !== 'string') {
      throw new DealError("'assigned_to' must be a string or null", 400);
    }
    out.assigned_to = raw;
  }

  if ('notes' in body) {
    const raw = body.notes;
    if (raw !== null && typeof raw !== 'string') {
      throw new DealError("'notes' must be a string or null", 400);
    }
    if (typeof raw === 'string' && raw.length > MAX_NOTES_LEN) {
      throw new DealError(
        `'notes' must be ${MAX_NOTES_LEN} characters or fewer`,
        400
      );
    }
    out.notes = raw === null ? null : raw.trim();
  }

  if ('expected_close_date' in body) {
    const raw = body.expected_close_date;
    if (raw !== null && (typeof raw !== 'string' || !DATE_RE.test(raw))) {
      throw new DealError(
        "'expected_close_date' must be a \"YYYY-MM-DD\" date string or null",
        400
      );
    }
    out.expected_close_date = raw;
  }

  if ('status' in body) {
    const raw = body.status;
    if (
      typeof raw !== 'string' ||
      !DEAL_STATUSES.includes(raw as DealStatus)
    ) {
      throw new DealError(
        `'status' must be one of: ${DEAL_STATUSES.join(', ')}`,
        400
      );
    }
    out.status = raw as DealStatus;
  }

  return out;
}

/**
 * Verify `pipelineId` belongs to the account and `stageId` belongs to
 * that pipeline. Both are caller-supplied ids referencing other
 * resources, so — like a foreign contact id — a mismatch reads as a
 * 400 (bad input), not a 404 (this route's own resource is fine).
 */
export async function assertPipelineAndStage(
  db: SupabaseClient,
  accountId: string,
  pipelineId: string,
  stageId: string
): Promise<void> {
  const { data: pipeline } = await db
    .from('pipelines')
    .select('id')
    .eq('id', pipelineId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!pipeline) {
    throw new DealError("'pipeline_id' does not reference a pipeline in this account", 400);
  }

  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('id', stageId)
    .eq('pipeline_id', pipelineId)
    .maybeSingle();
  if (!stage) {
    throw new DealError("'stage_id' does not belong to 'pipeline_id'", 400);
  }
}

/** Verify a stage id belongs to a specific (already-known) pipeline. */
export async function assertStageInPipeline(
  db: SupabaseClient,
  pipelineId: string,
  stageId: string
): Promise<void> {
  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('id', stageId)
    .eq('pipeline_id', pipelineId)
    .maybeSingle();
  if (!stage) {
    throw new DealError("'stage_id' does not belong to this deal's pipeline", 400);
  }
}

/** Verify a contact id (if non-null) belongs to the account. */
export async function assertContactInAccount(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<void> {
  const { data } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) {
    throw new DealError("'contact_id' does not reference a contact in this account", 400);
  }
}

/** Verify an assignee id (if non-null) is a member profile of the account. */
export async function assertAssigneeInAccount(
  db: SupabaseClient,
  accountId: string,
  profileId: string
): Promise<void> {
  const { data } = await db
    .from('profiles')
    .select('id')
    .eq('id', profileId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (!data) {
    throw new DealError("'assigned_to' does not reference a member of this account", 400);
  }
}

/** The account's configured default currency, falling back to USD. */
export async function getAccountDefaultCurrency(
  db: SupabaseClient,
  accountId: string
): Promise<string> {
  const { data } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', accountId)
    .maybeSingle();
  return (data?.default_currency as string | undefined) ?? DEFAULT_CURRENCY;
}
