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

import { generateFollowupSuggestions } from './followup-generate';

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

const OLD = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago — stale
const RECENT = new Date().toISOString(); // just now — not stale

interface Deal {
  id: string;
  contact_id: string;
  conversation_id: string;
  stage_id: string;
  pipeline_id: string;
  contact: { name: string; has_purchased: boolean };
  conversation: { last_message_at: string | null };
}

function deal(overrides: Partial<Deal> & { contact_id: string }): Deal {
  return {
    id: `deal-${overrides.contact_id}`,
    conversation_id: `conv-${overrides.contact_id}`,
    stage_id: 'stage-1',
    pipeline_id: 'pipe-1',
    contact: { name: `Lead ${overrides.contact_id}`, has_purchased: false },
    conversation: { last_message_at: OLD },
    ...overrides,
  };
}

function fakeDb(opts: { deals: Deal[]; pendingContactIds: string[] }) {
  const inserted: Record<string, unknown>[] = [];
  const from = (table: string) => {
    if (table === 'deals') {
      return {
        select: () => ({
          eq: () => ({ eq: () => Promise.resolve({ data: opts.deals, error: null }) }),
        }),
      };
    }
    if (table === 'ai_suggestions') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                in: () =>
                  Promise.resolve({
                    data: opts.pendingContactIds.map((id) => ({ contact_id: id })),
                    error: null,
                  }),
              }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ data: null, error: null });
        },
      };
    }
    if (table === 'pipeline_stages') {
      return { select: () => ({ in: () => Promise.resolve({ data: [{ id: 'stage-1', name: 'Qualificação' }], error: null }) }) };
    }
    if (table === 'lead_intelligence') {
      return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) };
    }
    throw new Error(`unexpected table in test: ${table}`);
  };
  return { db: { from } as unknown as SupabaseClient, inserted };
}

function scoreResponse(json: unknown) {
  return { text: JSON.stringify(json), usage: null };
}

beforeEach(() => {
  mocks.loadAiConfig.mockReset().mockResolvedValue(CONFIG);
  mocks.logAiUsage.mockReset().mockResolvedValue(undefined);
  mocks.generateOpenAi.mockReset();
  mocks.generateAnthropic.mockReset();
});

describe('generateFollowupSuggestions', () => {
  it('does nothing when AI is not configured/active', async () => {
    mocks.loadAiConfig.mockResolvedValue(null);
    const { db } = fakeDb({ deals: [], pendingContactIds: [] });
    const result = await generateFollowupSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 0, scored: 0 });
    expect(mocks.generateOpenAi).not.toHaveBeenCalled();
  });

  it('excludes conversations that are not actually stale', async () => {
    const { db, inserted } = fakeDb({
      deals: [deal({ contact_id: 'c1', conversation: { last_message_at: RECENT } })],
      pendingContactIds: [],
    });
    mocks.generateOpenAi.mockResolvedValue(scoreResponse({ should_suggest: false }));
    const result = await generateFollowupSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 0, scored: 0 });
    expect(inserted).toHaveLength(0);
  });

  it('excludes a contact that already has a pending follow-up (no duplicate)', async () => {
    const { db, inserted } = fakeDb({
      deals: [deal({ contact_id: 'c1' })],
      pendingContactIds: ['c1'],
    });
    const result = await generateFollowupSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 0, scored: 0 });
    expect(inserted).toHaveLength(0);
    expect(mocks.generateOpenAi).not.toHaveBeenCalled();
  });

  it('creates a suggestion for a stale candidate that clears the score bar', async () => {
    const { db, inserted } = fakeDb({ deals: [deal({ contact_id: 'c1' })], pendingContactIds: [] });
    mocks.generateOpenAi.mockResolvedValue(
      scoreResponse({
        should_suggest: true,
        reason: 'Sumiu após perguntar condições.',
        approach_summary: 'Retomar com as condições.',
        score: 80,
      }),
    );

    const result = await generateFollowupSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 1, scored: 1 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      category: 'followup',
      contact_id: 'c1',
      status: 'pending',
      title: 'Sumiu após perguntar condições.',
    });
    expect((inserted[0].payload as Record<string, unknown>).score).toBe(80);
  });

  it('scores but does not create a suggestion below the minimum score', async () => {
    const { db, inserted } = fakeDb({ deals: [deal({ contact_id: 'c1' })], pendingContactIds: [] });
    mocks.generateOpenAi.mockResolvedValue(
      scoreResponse({ should_suggest: true, reason: 'sinal fraco', score: 40 }),
    );

    const result = await generateFollowupSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 0, scored: 1 });
    expect(inserted).toHaveLength(0);
  });

  it('does not create a suggestion when the model finds no evidence', async () => {
    const { db, inserted } = fakeDb({ deals: [deal({ contact_id: 'c1' })], pendingContactIds: [] });
    mocks.generateOpenAi.mockResolvedValue(scoreResponse({ should_suggest: false }));

    const result = await generateFollowupSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 0, scored: 1 });
    expect(inserted).toHaveLength(0);
  });

  it('scores multiple independent candidates', async () => {
    const { db, inserted } = fakeDb({
      deals: [deal({ contact_id: 'c1' }), deal({ contact_id: 'c2' })],
      pendingContactIds: [],
    });
    mocks.generateOpenAi
      .mockResolvedValueOnce(scoreResponse({ should_suggest: true, reason: 'r1', score: 90 }))
      .mockResolvedValueOnce(scoreResponse({ should_suggest: false }));

    const result = await generateFollowupSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 1, scored: 2 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].contact_id).toBe('c1');
  });
});
