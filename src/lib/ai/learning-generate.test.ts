import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  logAiUsage: vi.fn(),
  generateOpenAi: vi.fn(),
  generateAnthropic: vi.fn(),
}));

vi.mock('./config', () => ({ loadAiConfig: mocks.loadAiConfig }));
vi.mock('./usage', () => ({ logAiUsage: mocks.logAiUsage }));
vi.mock('./providers/openai', () => ({ generateOpenAi: mocks.generateOpenAi }));
vi.mock('./providers/anthropic', () => ({ generateAnthropic: mocks.generateAnthropic }));

import { generateLearningSuggestions } from './learning-generate';

const CONFIG = {
  provider: 'openai' as const,
  model: 'gpt-test',
  apiKey: 'sk-test',
  systemPrompt: null,
  isActive: true,
  autoReplyEnabled: false,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
  embeddingsApiKey: null,
};

interface DbOpts {
  learningLastScannedAt?: string | null;
  conversationIds?: string[];
  messages?: { sender_type: 'customer' | 'agent' | 'bot'; content_text: string | null; created_at: string }[];
  knownDocTitles?: string[];
  pendingLearnings?: { id: string; title: string; payload: Record<string, unknown> }[];
}

function thenable<T>(data: T) {
  return {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in() {
      return this;
    },
    gt() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({ data, error: null });
    },
    then(resolve: (v: { data: T; error: null }) => void) {
      resolve({ data, error: null });
    },
  };
}

function fakeDb(opts: DbOpts) {
  const inserted: Record<string, unknown>[] = [];
  const updated: { table: string; patch: Record<string, unknown> }[] = [];

  const from = (table: string) => {
    if (table === 'ai_configs') {
      return {
        select: () => thenable({ learning_last_scanned_at: opts.learningLastScannedAt ?? null }),
        update: (patch: Record<string, unknown>) => {
          updated.push({ table, patch });
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
    }
    if (table === 'conversations') {
      return { select: () => thenable((opts.conversationIds ?? []).map((id) => ({ id }))) };
    }
    if (table === 'messages') {
      return { select: () => thenable(opts.messages ?? []) };
    }
    if (table === 'ai_knowledge_documents') {
      return { select: () => thenable((opts.knownDocTitles ?? []).map((title) => ({ title }))) };
    }
    if (table === 'ai_suggestions') {
      return {
        select: () => thenable(opts.pendingLearnings ?? []),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ data: null, error: null });
        },
        update: (patch: Record<string, unknown>) => {
          updated.push({ table, patch });
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
    }
    throw new Error(`unexpected table in test: ${table}`);
  };

  return { db: { from } as unknown as SupabaseClient, inserted, updated };
}

function scanResponse(learnings: unknown[]) {
  return { text: JSON.stringify({ learnings }), usage: null };
}

beforeEach(() => {
  mocks.loadAiConfig.mockReset().mockResolvedValue(CONFIG);
  mocks.logAiUsage.mockReset().mockResolvedValue(undefined);
  mocks.generateOpenAi.mockReset();
  mocks.generateAnthropic.mockReset();
});

const BASE_MESSAGES = [
  { sender_type: 'customer' as const, content_text: 'Vocês aceitam 20% de entrada?', created_at: '2026-01-01T10:00:00Z' },
  { sender_type: 'agent' as const, content_text: 'Sim, aceitamos entrada de 20% em lançamentos.', created_at: '2026-01-01T10:01:00Z' },
];

describe('generateLearningSuggestions', () => {
  it('does nothing when AI is not configured/active', async () => {
    mocks.loadAiConfig.mockResolvedValue(null);
    const { db } = fakeDb({});
    expect(await generateLearningSuggestions(db, 'account-1')).toEqual({ created: 0, touched: 0 });
    expect(mocks.generateOpenAi).not.toHaveBeenCalled();
  });

  it('does nothing when the account has no conversations', async () => {
    const { db } = fakeDb({ conversationIds: [] });
    expect(await generateLearningSuggestions(db, 'account-1')).toEqual({ created: 0, touched: 0 });
  });

  it('advances the cursor and stops when there is nothing new to read', async () => {
    const { db, updated } = fakeDb({ conversationIds: ['c1'], messages: [] });
    const result = await generateLearningSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 0, touched: 0 });
    expect(updated.some((u) => u.table === 'ai_configs')).toBe(true);
    expect(mocks.generateOpenAi).not.toHaveBeenCalled();
  });

  it('creates a suggestion for a recurring, non-isolated, confident pattern', async () => {
    const { db, inserted } = fakeDb({ conversationIds: ['c1'], messages: BASE_MESSAGES });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([
        {
          type: 'commercial_rule',
          info: 'Entrada de 20% é aceita para lançamentos.',
          context_summary: 'Perguntado várias vezes.',
          application: 'Informar de cara aos leads que perguntam.',
          occurrence_count: 3,
          confidence: 'high',
          is_isolated: false,
        },
      ]),
    );

    const result = await generateLearningSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 1, touched: 0 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      category: 'learning',
      status: 'pending',
      title: 'Entrada de 20% é aceita para lançamentos.',
    });
    expect((inserted[0].payload as Record<string, unknown>).occurrence_count).toBe(3);
  });

  it('skips an isolated observation', async () => {
    const { db, inserted } = fakeDb({ conversationIds: ['c1'], messages: BASE_MESSAGES });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([{ info: 'Cliente pediu para ligar às 18h.', confidence: 'high', is_isolated: true }]),
    );
    await generateLearningSuggestions(db, 'account-1');
    expect(inserted).toHaveLength(0);
  });

  it('skips a low-confidence candidate', async () => {
    const { db, inserted } = fakeDb({ conversationIds: ['c1'], messages: BASE_MESSAGES });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([{ info: 'Talvez um padrão.', confidence: 'low', is_isolated: false }]),
    );
    await generateLearningSuggestions(db, 'account-1');
    expect(inserted).toHaveLength(0);
  });

  it('increments occurrence_count on an existing pending suggestion instead of duplicating', async () => {
    const { db, inserted, updated } = fakeDb({
      conversationIds: ['c1'],
      messages: BASE_MESSAGES,
      pendingLearnings: [
        { id: 'sugg-1', title: 'Entrada de 20% é aceita para lançamentos.', payload: { occurrence_count: 2 } },
      ],
    });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([
        {
          info: 'Entrada de 20% é aceita para lançamentos.',
          confidence: 'high',
          is_isolated: false,
          occurrence_count: 1,
        },
      ]),
    );

    const result = await generateLearningSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 0, touched: 1 });
    expect(inserted).toHaveLength(0);
    const suggUpdate = updated.find((u) => u.table === 'ai_suggestions');
    expect((suggUpdate?.patch.payload as Record<string, unknown>).occurrence_count).toBe(3);
  });

  it('does not re-suggest something already in the knowledge base', async () => {
    const { db, inserted } = fakeDb({
      conversationIds: ['c1'],
      messages: BASE_MESSAGES,
      knownDocTitles: ['Entrada de 20% é aceita para lançamentos.'],
    });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([
        { info: 'Entrada de 20% é aceita para lançamentos.', confidence: 'high', is_isolated: false },
      ]),
    );
    await generateLearningSuggestions(db, 'account-1');
    expect(inserted).toHaveLength(0);
  });
});
