import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';

const CONFIG_COLUMNS =
  'id, enabled, model_provider, model_name, instructions, auto_reply, auto_move_deals, handoff_keywords, max_messages, cooldown_seconds';

const DEFAULT_CONFIG = {
  id: null,
  enabled: false,
  model_provider: 'openai',
  model_name: 'gpt-4.1-mini',
  instructions: '',
  auto_reply: true,
  auto_move_deals: false,
  handoff_keywords: ['humano', 'atendente', 'cancelar'],
  max_messages: 20,
  cooldown_seconds: 15,
};

type ConfigInput = Omit<typeof DEFAULT_CONFIG, 'id'>;

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('ai_agents')
      .select(CONFIG_COLUMNS)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[GET /api/ai-agent/config] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load AI agent configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? DEFAULT_CONFIG);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json().catch(() => null);
    const config = normalizeConfig(body);

    if ('error' in config) {
      return NextResponse.json({ error: config.error }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('ai_agents')
      .upsert(
        {
          account_id: ctx.accountId,
          user_id: ctx.userId,
          ...config,
        },
        { onConflict: 'account_id' }
      )
      .select(CONFIG_COLUMNS)
      .single();

    if (error || !data) {
      console.error('[PATCH /api/ai-agent/config] upsert error:', error);
      return NextResponse.json(
        { error: 'Failed to save AI agent configuration' },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}

function normalizeConfig(body: unknown): ConfigInput | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }

  const input = body as Record<string, unknown>;
  const modelProvider = normalizeString(
    input.model_provider,
    DEFAULT_CONFIG.model_provider,
    40,
    'model_provider'
  );
  const modelName = normalizeString(
    input.model_name,
    DEFAULT_CONFIG.model_name,
    80,
    'model_name'
  );
  const instructions = normalizeInstructions(input.instructions);
  const handoffKeywords = normalizeKeywords(input.handoff_keywords);
  const maxMessages = normalizeInteger(
    input.max_messages,
    1,
    50,
    'max_messages'
  );
  const cooldownSeconds = normalizeInteger(
    input.cooldown_seconds,
    5,
    3600,
    'cooldown_seconds'
  );

  for (const value of [
    modelProvider,
    modelName,
    instructions,
    handoffKeywords,
    maxMessages,
    cooldownSeconds,
  ]) {
    if (typeof value === 'object' && value && 'error' in value) return value;
  }
  if (modelProvider !== 'openai') {
    return { error: 'model_provider must be openai' };
  }

  const booleans = ['enabled', 'auto_reply', 'auto_move_deals'] as const;
  for (const field of booleans) {
    if (field in input && typeof input[field] !== 'boolean') {
      return { error: `${field} must be a boolean` };
    }
  }

  const enabled =
    input.enabled === undefined ? DEFAULT_CONFIG.enabled : input.enabled;
  const autoReply =
    input.auto_reply === undefined
      ? DEFAULT_CONFIG.auto_reply
      : input.auto_reply;
  const autoMoveDeals =
    input.auto_move_deals === undefined
      ? DEFAULT_CONFIG.auto_move_deals
      : input.auto_move_deals;

  return {
    enabled: enabled as boolean,
    model_provider: modelProvider as string,
    model_name: modelName as string,
    instructions: instructions as string,
    auto_reply: autoReply as boolean,
    auto_move_deals: autoMoveDeals as boolean,
    handoff_keywords: handoffKeywords as string[],
    max_messages: maxMessages as number,
    cooldown_seconds: cooldownSeconds as number,
  };
}

function normalizeString(
  value: unknown,
  fallback: string,
  maxLength: number,
  field: string
): string | { error: string } {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim()) {
    return { error: `${field} must be a non-empty string` };
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    return { error: `${field} must be ${maxLength} characters or fewer` };
  }
  return normalized;
}

function normalizeInstructions(value: unknown): string | { error: string } {
  if (value === undefined) return DEFAULT_CONFIG.instructions;
  if (typeof value !== 'string')
    return { error: 'instructions must be a string' };
  if (value.length > 4000) {
    return { error: 'instructions must be 4000 characters or fewer' };
  }
  return value;
}

function normalizeKeywords(value: unknown): string[] | { error: string } {
  if (value === undefined) return DEFAULT_CONFIG.handoff_keywords;
  const items = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(items) || items.some((item) => typeof item !== 'string')) {
    return {
      error: 'handoff_keywords must be an array or comma-separated string',
    };
  }
  const normalized = items
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length > 20 || normalized.some((item) => item.length > 40)) {
    return {
      error: 'handoff_keywords supports up to 20 items of 40 characters each',
    };
  }
  return normalized;
}

function normalizeInteger(
  value: unknown,
  min: number,
  max: number,
  field: string
): number | { error: string } {
  const fallback =
    field === 'max_messages'
      ? DEFAULT_CONFIG.max_messages
      : DEFAULT_CONFIG.cooldown_seconds;
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    return { error: `${field} must be an integer between ${min} and ${max}` };
  }
  return value;
}
