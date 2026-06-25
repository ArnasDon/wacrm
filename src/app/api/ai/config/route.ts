// ============================================================
// /api/ai/config
//
//   GET — read this account's AI assistant config (spec §4.1, §9,
//         §10). Seeds a default row the first time the AI Settings
//         tab is opened (mirroring how other settings rows are
//         lazily created), so the UI always gets a config to bind.
//         Adds a server-computed `apiKeyConfigured` boolean —
//         whether `ANTHROPIC_API_KEY` is set in the environment.
//         The key ITSELF is never returned (spec §9.1, §12).
//   PUT — update the editable fields. Admin+ only.
//
// Both verbs go through the cookie-session Supabase server client,
// so RLS enforces tenancy. On top of that the `ai_assistant_config`
// RLS policies are admin-only (migration 027), but we ALSO gate the
// route with `requireRole('admin')` — the same belt-and-braces
// pattern as `/api/account/api-keys` (explicit role check + RLS),
// so an under-privileged caller gets a clean 403 instead of an
// opaque empty result from RLS.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import type { AiAssistantConfig } from '@/types';

// Columns the client may read. Mirrors `AiAssistantConfig`; there is
// no secret column on this table (the Anthropic key lives in env, not
// the DB), so we select everything the row holds.
const CONFIG_COLUMNS =
  'id, account_id, enabled, system_prompt, handoff_message, escalation_keywords, business_name, logo_url, model, daily_reply_cap, created_at, updated_at';

// Bounds on caller-supplied free text, so a runaway paste can't bloat
// the row (and, downstream, the prompt). Generous — these are admin
// settings, not user input.
const MAX_PROMPT_LEN = 20_000;
const MAX_HANDOFF_LEN = 2_000;
const MAX_BUSINESS_NAME_LEN = 200;
const MAX_LOGO_URL_LEN = 2_000;
const MAX_MODEL_LEN = 100;
const MAX_KEYWORDS = 100;
const MAX_KEYWORD_LEN = 80;
// Daily reply cap is a positive integer; clamp the ceiling so a typo
// can't disable the cost guard entirely.
const MAX_DAILY_REPLY_CAP = 100_000;

/**
 * Whether the Anthropic key is present in the server environment.
 * Computed per-request and surfaced as a plain boolean so Settings can
 * show a "key configured / not configured" status WITHOUT the key ever
 * crossing to the client (spec §9.1, §12).
 */
function apiKeyConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function GET() {
  try {
    // Settings-class read: admin+ only, matching the table's RLS.
    const ctx = await requireRole('admin');

    // Try to read the (at most one) config row for this account.
    const { data: existing, error: selectError } = await ctx.supabase
      .from('ai_assistant_config')
      .select(CONFIG_COLUMNS)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (selectError) {
      console.error('[GET /api/ai/config] fetch error:', selectError);
      return NextResponse.json(
        { error: 'Failed to load AI configuration' },
        { status: 500 }
      );
    }

    if (existing) {
      return NextResponse.json({
        config: existing as AiAssistantConfig,
        apiKeyConfigured: apiKeyConfigured(),
      });
    }

    // No row yet — the account has never opened this tab. Seed a
    // default row so the UI always has something to bind to. Every
    // column has a DB default (migration 027), so we only supply
    // `account_id`; Postgres fills the seeded prompt, keywords,
    // model, and cap. RLS `ai_assistant_config_insert` permits this
    // because `requireRole('admin')` already proved the caller is
    // admin+ for this account.
    const { data: seeded, error: insertError } = await ctx.supabase
      .from('ai_assistant_config')
      .insert({ account_id: ctx.accountId })
      .select(CONFIG_COLUMNS)
      .single();

    if (insertError || !seeded) {
      console.error('[GET /api/ai/config] seed error:', insertError);
      return NextResponse.json(
        { error: 'Failed to initialize AI configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      config: seeded as AiAssistantConfig,
      apiKeyConfigured: apiKeyConfigured(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');

    // Per-admin limit on settings mutations — bounds accidental abuse
    // (a loop) and a compromised session, with its own bucket so it
    // doesn't starve other admin endpoints.
    const limit = checkRateLimit(
      `admin:aiConfigUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      enabled?: unknown;
      system_prompt?: unknown;
      handoff_message?: unknown;
      escalation_keywords?: unknown;
      business_name?: unknown;
      logo_url?: unknown;
      model?: unknown;
      daily_reply_cap?: unknown;
    } | null;

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 }
      );
    }

    // Build the update from only the editable fields that were
    // supplied. Validate each; reject the whole request on any bad
    // field rather than silently dropping it. `id`, `account_id`, and
    // the timestamps are never writable here.
    const updates: Record<string, unknown> = {};

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        return NextResponse.json(
          { error: "'enabled' must be a boolean" },
          { status: 400 }
        );
      }
      updates.enabled = body.enabled;
    }

    if (body.system_prompt !== undefined) {
      if (typeof body.system_prompt !== 'string') {
        return NextResponse.json(
          { error: "'system_prompt' must be a string" },
          { status: 400 }
        );
      }
      const prompt = body.system_prompt.trim();
      // NOT NULL in the DB — an empty prompt would strip the safety
      // instructions, so require non-empty.
      if (prompt.length === 0) {
        return NextResponse.json(
          { error: "'system_prompt' cannot be empty" },
          { status: 400 }
        );
      }
      if (prompt.length > MAX_PROMPT_LEN) {
        return NextResponse.json(
          {
            error: `'system_prompt' must be ${MAX_PROMPT_LEN} characters or fewer`,
          },
          { status: 400 }
        );
      }
      updates.system_prompt = prompt;
    }

    if (body.handoff_message !== undefined) {
      // Nullable column — null/empty means "send nothing on escalation".
      if (body.handoff_message === null) {
        updates.handoff_message = null;
      } else if (typeof body.handoff_message === 'string') {
        const msg = body.handoff_message.trim();
        if (msg.length > MAX_HANDOFF_LEN) {
          return NextResponse.json(
            {
              error: `'handoff_message' must be ${MAX_HANDOFF_LEN} characters or fewer`,
            },
            { status: 400 }
          );
        }
        updates.handoff_message = msg.length === 0 ? null : msg;
      } else {
        return NextResponse.json(
          { error: "'handoff_message' must be a string or null" },
          { status: 400 }
        );
      }
    }

    if (body.escalation_keywords !== undefined) {
      if (!Array.isArray(body.escalation_keywords)) {
        return NextResponse.json(
          { error: "'escalation_keywords' must be an array of strings" },
          { status: 400 }
        );
      }
      if (body.escalation_keywords.length > MAX_KEYWORDS) {
        return NextResponse.json(
          { error: `At most ${MAX_KEYWORDS} escalation keywords are allowed` },
          { status: 400 }
        );
      }
      const keywords: string[] = [];
      for (const raw of body.escalation_keywords) {
        if (typeof raw !== 'string') {
          return NextResponse.json(
            { error: "'escalation_keywords' must be an array of strings" },
            { status: 400 }
          );
        }
        const kw = raw.trim().toLowerCase();
        if (kw.length === 0) continue; // drop blanks
        if (kw.length > MAX_KEYWORD_LEN) {
          return NextResponse.json(
            {
              error: `Each escalation keyword must be ${MAX_KEYWORD_LEN} characters or fewer`,
            },
            { status: 400 }
          );
        }
        if (!keywords.includes(kw)) keywords.push(kw); // de-dupe
      }
      updates.escalation_keywords = keywords;
    }

    if (body.business_name !== undefined) {
      if (body.business_name === null) {
        updates.business_name = null;
      } else if (typeof body.business_name === 'string') {
        const name = body.business_name.trim();
        if (name.length > MAX_BUSINESS_NAME_LEN) {
          return NextResponse.json(
            {
              error: `'business_name' must be ${MAX_BUSINESS_NAME_LEN} characters or fewer`,
            },
            { status: 400 }
          );
        }
        updates.business_name = name.length === 0 ? null : name;
      } else {
        return NextResponse.json(
          { error: "'business_name' must be a string or null" },
          { status: 400 }
        );
      }
    }

    if (body.logo_url !== undefined) {
      if (body.logo_url === null) {
        updates.logo_url = null;
      } else if (typeof body.logo_url === 'string') {
        const url = body.logo_url.trim();
        if (url.length > MAX_LOGO_URL_LEN) {
          return NextResponse.json(
            {
              error: `'logo_url' must be ${MAX_LOGO_URL_LEN} characters or fewer`,
            },
            { status: 400 }
          );
        }
        updates.logo_url = url.length === 0 ? null : url;
      } else {
        return NextResponse.json(
          { error: "'logo_url' must be a string or null" },
          { status: 400 }
        );
      }
    }

    if (body.model !== undefined) {
      if (typeof body.model !== 'string') {
        return NextResponse.json(
          { error: "'model' must be a string" },
          { status: 400 }
        );
      }
      const model = body.model.trim();
      // NOT NULL with a DB default — never allow it to be blanked.
      if (model.length === 0) {
        return NextResponse.json(
          { error: "'model' cannot be empty" },
          { status: 400 }
        );
      }
      if (model.length > MAX_MODEL_LEN) {
        return NextResponse.json(
          { error: `'model' must be ${MAX_MODEL_LEN} characters or fewer` },
          { status: 400 }
        );
      }
      updates.model = model;
    }

    if (body.daily_reply_cap !== undefined) {
      const cap = body.daily_reply_cap;
      if (
        typeof cap !== 'number' ||
        !Number.isInteger(cap) ||
        cap < 1 ||
        cap > MAX_DAILY_REPLY_CAP
      ) {
        return NextResponse.json(
          {
            error: `'daily_reply_cap' must be an integer between 1 and ${MAX_DAILY_REPLY_CAP}`,
          },
          { status: 400 }
        );
      }
      updates.daily_reply_cap = cap;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No editable fields supplied' },
        { status: 400 }
      );
    }

    // Update the account's row. RLS `ai_assistant_config_update` allows
    // this because `requireRole('admin')` already proved the caller is
    // admin+ for this account; `.eq('account_id')` keeps it scoped even
    // so. If the row doesn't exist yet (the tab was never opened), seed
    // it from the supplied values merged over the column defaults, then
    // re-run as an insert so PUT is usable without a prior GET.
    const { data: updated, error: updateError } = await ctx.supabase
      .from('ai_assistant_config')
      .update(updates)
      .eq('account_id', ctx.accountId)
      .select(CONFIG_COLUMNS)
      .maybeSingle();

    if (updateError) {
      console.error('[PUT /api/ai/config] update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update AI configuration' },
        { status: 500 }
      );
    }

    if (updated) {
      return NextResponse.json({
        config: updated as AiAssistantConfig,
        apiKeyConfigured: apiKeyConfigured(),
      });
    }

    // No existing row matched — seed one with the supplied values laid
    // over the DB column defaults.
    const { data: inserted, error: insertError } = await ctx.supabase
      .from('ai_assistant_config')
      .insert({ account_id: ctx.accountId, ...updates })
      .select(CONFIG_COLUMNS)
      .single();

    if (insertError || !inserted) {
      console.error('[PUT /api/ai/config] seed error:', insertError);
      return NextResponse.json(
        { error: 'Failed to update AI configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      config: inserted as AiAssistantConfig,
      apiKeyConfigured: apiKeyConfigured(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
