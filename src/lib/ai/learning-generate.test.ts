import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  logAiUsage: vi.fn(),
  generateOpenAi: vi.fn(),
  generateAnthropic: vi.fn(),
  generateDeepSeek: vi.fn(),
  applyPropertySubjectiveLearning: vi.fn(),
  resolvePropertyIdentity: vi.fn(),
  findConversationEvidence: vi.fn(),
  recordPropertyLearningEvidence: vi.fn(),
  consolidateMemory: vi.fn(),
}));

vi.mock('./config', () => ({ loadAiConfig: mocks.loadAiConfig }));
vi.mock('./usage', () => ({ logAiUsage: mocks.logAiUsage }));
vi.mock('./providers/openai', () => ({ generateOpenAi: mocks.generateOpenAi }));
vi.mock('./providers/anthropic', () => ({ generateAnthropic: mocks.generateAnthropic }));
vi.mock('./providers/deepseek', () => ({ generateDeepSeek: mocks.generateDeepSeek }));
vi.mock('./property-learning-apply', async () => {
  const actual = await vi.importActual<typeof import('./property-learning-apply')>('./property-learning-apply');
  return { ...actual, applyPropertySubjectiveLearning: mocks.applyPropertySubjectiveLearning };
});
// consolidateMemory's own policy (candidate/active ladder, conflict
// handling, text equivalence) is covered end-to-end in
// memory-consolidation.test.ts — here we only need to control whether it
// "took" so the orchestration tests below aren't exercising the real
// consolidation logic.
vi.mock('./memory-consolidation', () => ({ consolidateMemory: mocks.consolidateMemory }));
// Identity resolution/evidence itself is covered in property-identity.test.ts —
// here we only need to control it so the orchestration tests below aren't
// exercising real fuzzy matching or hitting untracked DB tables.
vi.mock('./property-identity', () => ({
  resolvePropertyIdentity: mocks.resolvePropertyIdentity,
  findConversationEvidence: mocks.findConversationEvidence,
  recordPropertyLearningEvidence: mocks.recordPropertyLearningEvidence,
}));

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

const RONALDO_ID = 'agent-ronaldo';
const TATIANNA_ID = 'agent-tatianna';
const DEFAULT_PROFILES = [
  { user_id: RONALDO_ID, full_name: 'Ronaldo Meira' },
  { user_id: TATIANNA_ID, full_name: 'Thatianna Oliveira' },
];

interface FixtureMessage {
  id?: string;
  conversation_id: string;
  sender_type: 'customer' | 'agent' | 'bot';
  sender_id?: string | null;
  content_type?: 'text' | 'audio';
  content_text?: string | null;
  transcript_text?: string | null;
  created_at: string;
  property_id?: string | null;
  property_name?: string | null;
  ad_source_id?: string | null;
  contact_id?: string | null;
}

function withDefaults(m: FixtureMessage, i: number) {
  return {
    id: m.id ?? `msg-${i}`,
    conversation_id: m.conversation_id,
    sender_type: m.sender_type,
    sender_id: m.sender_id ?? null,
    content_type: m.content_type ?? 'text',
    content_text: m.content_text ?? null,
    transcript_text: m.transcript_text ?? null,
    created_at: m.created_at,
    conversations: {
      account_id: 'account-1',
      property_id: m.property_id ?? null,
      contact_id: m.contact_id ?? null,
      ctwa_referral: m.ad_source_id ? { source_id: m.ad_source_id } : null,
      properties: m.property_name ? { name: m.property_name } : null,
    },
  };
}

interface DbOpts {
  learningLastScannedAt?: string | null;
  messages?: FixtureMessage[];
  profiles?: { user_id: string; full_name: string }[];
  knownDocTitles?: string[];
  pendingLearnings?: { id: string; title: string; payload: Record<string, unknown> }[];
  ownerUserId?: string | null;
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
  const messageRows = (opts.messages ?? []).map(withDefaults);

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
    if (table === 'messages') {
      return { select: () => thenable(messageRows) };
    }
    if (table === 'profiles') {
      return { select: () => thenable(opts.profiles ?? DEFAULT_PROFILES) };
    }
    if (table === 'ai_knowledge_documents') {
      return { select: () => thenable((opts.knownDocTitles ?? []).map((title) => ({ title }))) };
    }
    if (table === 'accounts') {
      return { select: () => thenable({ owner_user_id: opts.ownerUserId ?? 'owner-1' }) };
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
  mocks.generateDeepSeek.mockReset();
  mocks.applyPropertySubjectiveLearning.mockReset();
  mocks.resolvePropertyIdentity.mockReset().mockResolvedValue({ kind: 'no_match' });
  mocks.findConversationEvidence.mockReset().mockReturnValue({ mentioned: new Set(), withContext: new Set() });
  mocks.recordPropertyLearningEvidence.mockReset().mockResolvedValue(undefined);
  mocks.consolidateMemory.mockReset().mockResolvedValue({
    action: 'created_candidate',
    memory: { id: 'mem-1', status: 'candidate' },
  });
});

const BASE_MESSAGES: FixtureMessage[] = [
  {
    conversation_id: 'conv-1',
    sender_type: 'customer',
    content_text: 'Vocês aceitam 20% de entrada?',
    created_at: '2026-01-01T10:00:00Z',
  },
  {
    conversation_id: 'conv-1',
    sender_type: 'agent',
    sender_id: RONALDO_ID,
    content_text: 'Sim, aceitamos entrada de 20% em lançamentos.',
    created_at: '2026-01-01T10:01:00Z',
  },
];

describe('generateLearningSuggestions', () => {
  it('does nothing when AI is not configured/active', async () => {
    mocks.loadAiConfig.mockResolvedValue(null);
    const { db } = fakeDb({});
    expect(await generateLearningSuggestions(db, 'account-1')).toEqual({ created: 0, touched: 0 });
    expect(mocks.generateOpenAi).not.toHaveBeenCalled();
  });

  it('does nothing when there are no new messages, and advances the cursor to "now" (nothing to skip)', async () => {
    const { db, updated } = fakeDb({ messages: [] });
    const result = await generateLearningSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 0, touched: 0 });
    expect(updated.some((u) => u.table === 'ai_configs')).toBe(true);
    expect(mocks.generateOpenAi).not.toHaveBeenCalled();
  });

  it('dispatches to generateDeepSeek when provider is deepseek', async () => {
    mocks.loadAiConfig.mockResolvedValue({
      ...CONFIG,
      provider: 'deepseek',
      model: 'deepseek-flash',
      deepseekApiKey: 'sk-ds-test',
    });
    mocks.generateDeepSeek.mockResolvedValue({
      text: JSON.stringify({ learnings: [] }),
      usage: null,
    });
    const { db } = fakeDb({ messages: BASE_MESSAGES });
    await generateLearningSuggestions(db, 'account-1');
    expect(mocks.generateDeepSeek).toHaveBeenCalledTimes(1);
    expect(mocks.generateDeepSeek).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-ds-test',
        model: 'deepseek-flash',
      }),
    );
    expect(mocks.generateOpenAi).not.toHaveBeenCalled();
    expect(mocks.generateAnthropic).not.toHaveBeenCalled();
  });

  it('creates a suggestion for a recurring, non-isolated, confident pattern', async () => {
    const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
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
    const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([{ info: 'Cliente pediu para ligar às 18h.', confidence: 'high', is_isolated: true }]),
    );
    await generateLearningSuggestions(db, 'account-1');
    expect(inserted).toHaveLength(0);
  });

  it('skips a low-confidence candidate', async () => {
    const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([{ info: 'Talvez um padrão.', confidence: 'low', is_isolated: false }]),
    );
    await generateLearningSuggestions(db, 'account-1');
    expect(inserted).toHaveLength(0);
  });

  it('increments occurrence_count on an existing pending suggestion instead of duplicating', async () => {
    const { db, inserted, updated } = fakeDb({
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

  it('auto-applies a high-confidence, non-isolated, recurring property_subjective learning (Parte 4)', async () => {
    mocks.applyPropertySubjectiveLearning.mockResolvedValue({ propertyId: 'prop-x', previousKnowledge: null });
    const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([
        {
          type: 'property_subjective',
          info: 'Sempre pergunta sobre vaga de garagem dupla no Residencial Aurora.',
          context_summary: 'Padrão recorrente sobre o Residencial Aurora.',
          application: null,
          occurrence_count: 3,
          confidence: 'high',
          is_isolated: false,
          property_name: 'Residencial Aurora',
        },
      ]),
    );

    const result = await generateLearningSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 1, touched: 0 });
    expect(mocks.applyPropertySubjectiveLearning).toHaveBeenCalledTimes(1);
    expect(mocks.applyPropertySubjectiveLearning).toHaveBeenCalledWith(
      db,
      'account-1',
      CONFIG,
      'owner-1',
      { propertyName: 'Residencial Aurora', info: 'Sempre pergunta sobre vaga de garagem dupla no Residencial Aurora.' },
    );
    expect(inserted[0].status).toBe('approved');
    const payload = inserted[0].payload as Record<string, unknown>;
    expect(payload.auto_applied).toBe(true);
    expect(payload.applied_target).toBe('property_subjective');
    expect(payload.applied_property_id).toBe('prop-x');
  });

  it('keeps a property_subjective learning pending when occurrence_count is below the auto-apply threshold', async () => {
    const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([
        {
          type: 'property_subjective',
          info: 'Cliente perguntou sobre o Residencial Aurora.',
          occurrence_count: 2,
          confidence: 'high',
          is_isolated: false,
          property_name: 'Residencial Aurora',
        },
      ]),
    );

    const result = await generateLearningSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 1, touched: 0 });
    expect(inserted[0].status).toBe('pending');
    expect(mocks.applyPropertySubjectiveLearning).not.toHaveBeenCalled();
  });

  it('auto-applies once an existing pending property_subjective suggestion crosses the threshold across scans', async () => {
    mocks.applyPropertySubjectiveLearning.mockResolvedValue({ propertyId: 'prop-y', previousKnowledge: 'Texto antigo.' });
    const { db, updated } = fakeDb({
      messages: BASE_MESSAGES,
      pendingLearnings: [
        {
          id: 'sugg-1',
          title: 'Cliente perguntou sobre o Residencial Aurora.',
          payload: {
            type: 'property_subjective',
            info: 'Cliente perguntou sobre o Residencial Aurora.',
            occurrence_count: 2,
            confidence: 'high',
            property_name: 'Residencial Aurora',
          },
        },
      ],
    });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([
        {
          type: 'property_subjective',
          info: 'Cliente perguntou sobre o Residencial Aurora.',
          occurrence_count: 1,
          confidence: 'high',
          is_isolated: false,
          property_name: 'Residencial Aurora',
        },
      ]),
    );

    const result = await generateLearningSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 0, touched: 1 });
    const suggUpdate = updated.find((u) => u.table === 'ai_suggestions');
    expect(suggUpdate?.patch.status).toBe('approved');
    const payload = suggUpdate?.patch.payload as Record<string, unknown>;
    expect(payload.occurrence_count).toBe(3);
    expect(payload.auto_applied).toBe(true);
    expect(payload.applied_property_id).toBe('prop-y');
  });

  it('records conversation evidence for a property_subjective candidate whose name has no existing match', async () => {
    mocks.resolvePropertyIdentity.mockResolvedValue({ kind: 'no_match' });
    mocks.findConversationEvidence.mockReturnValue({
      mentioned: new Set(['conv-a']),
      withContext: new Set(['conv-a']),
    });
    const { db } = fakeDb({ messages: BASE_MESSAGES });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([
        {
          type: 'property_subjective',
          info: 'Cliente perguntou sobre o Residencial Aurora.',
          occurrence_count: 1,
          confidence: 'medium',
          is_isolated: false,
          property_name: 'Residencial Aurora',
        },
      ]),
    );

    await generateLearningSuggestions(db, 'account-1');
    expect(mocks.resolvePropertyIdentity).toHaveBeenCalledWith(db, 'account-1', 'Residencial Aurora');
    expect(mocks.recordPropertyLearningEvidence).toHaveBeenCalledWith(
      db,
      'account-1',
      'Residencial Aurora',
      new Set(['conv-a']),
      new Set(['conv-a']),
    );
  });

  it('never records evidence for an AMBIGUOUS property_subjective candidate — only genuine no_match accrues evidence (Problema 1 fix)', async () => {
    mocks.resolvePropertyIdentity.mockResolvedValue({
      kind: 'ambiguous',
      candidates: [
        { propertyId: 'prop-park', score: 0.7 },
        { propertyId: 'prop-home', score: 0.68 },
      ],
    });
    const { db } = fakeDb({ messages: BASE_MESSAGES });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([
        {
          type: 'property_subjective',
          info: 'Cliente perguntou sobre o Live.',
          occurrence_count: 1,
          confidence: 'medium',
          is_isolated: false,
          property_name: 'Live',
        },
      ]),
    );

    await generateLearningSuggestions(db, 'account-1');
    expect(mocks.findConversationEvidence).not.toHaveBeenCalled();
    expect(mocks.recordPropertyLearningEvidence).not.toHaveBeenCalled();
  });

  it('never records evidence for a property_subjective candidate whose name already resolves to an existing property', async () => {
    mocks.resolvePropertyIdentity.mockResolvedValue({ kind: 'safe_match', propertyId: 'prop-1', score: 0.95 });
    const { db } = fakeDb({ messages: BASE_MESSAGES });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([
        {
          type: 'property_subjective',
          info: 'Cliente perguntou sobre o Live Park.',
          occurrence_count: 1,
          confidence: 'medium',
          is_isolated: false,
          property_name: 'Liv Park',
        },
      ]),
    );

    await generateLearningSuggestions(db, 'account-1');
    expect(mocks.findConversationEvidence).not.toHaveBeenCalled();
    expect(mocks.recordPropertyLearningEvidence).not.toHaveBeenCalled();
  });

  it('never auto-applies a learning type with no scope of its own (never_rule), no matter how recurring — always needs a human', async () => {
    const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
    mocks.generateOpenAi.mockResolvedValue(
      scanResponse([
        {
          type: 'never_rule',
          info: 'Nunca prometer prazo de entrega antecipado sem aprovação da equipe.',
          occurrence_count: 5,
          confidence: 'high',
          is_isolated: false,
        },
      ]),
    );

    const result = await generateLearningSuggestions(db, 'account-1');
    expect(result).toEqual({ created: 1, touched: 0 });
    expect(inserted[0].status).toBe('pending');
    expect(mocks.applyPropertySubjectiveLearning).not.toHaveBeenCalled();
    expect(mocks.consolidateMemory).not.toHaveBeenCalled();
  });

  describe('auto-consolidation of common knowledge (no manual approval required)', () => {
    it('auto-consolidates a GLOBAL fact (business_rule) straight into ai_memories via consolidateMemory — no admin click needed', async () => {
      mocks.consolidateMemory.mockResolvedValue({
        action: 'created_candidate',
        memory: { id: 'mem-1', status: 'candidate' },
      });
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          { type: 'business_rule', info: 'Não trabalhamos com terrenos.', confidence: 'high', is_isolated: false },
        ]),
      );

      const result = await generateLearningSuggestions(db, 'account-1');
      expect(result).toEqual({ created: 1, touched: 0 });
      expect(mocks.consolidateMemory).toHaveBeenCalledTimes(1);
      expect(mocks.consolidateMemory).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          accountId: 'account-1',
          scope: 'global',
          knowledgeType: 'business_rule',
          content: 'Não trabalhamos com terrenos.',
        }),
      );
      expect(inserted[0].status).toBe('approved');
      const payload = inserted[0].payload as Record<string, unknown>;
      expect(payload.auto_applied).toBe(true);
      expect(payload.applied_target).toBe('memory:global');
      expect(payload.applied_memory_id).toBe('mem-1');
    });

    it('auto-consolidates a PROPERTY fact once its property_id resolves safely', async () => {
      mocks.resolvePropertyIdentity.mockResolvedValue({ kind: 'safe_match', propertyId: 'prop-live-park', score: 0.99 });
      mocks.consolidateMemory.mockResolvedValue({
        action: 'created_candidate',
        memory: { id: 'mem-2', status: 'candidate' },
      });
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          {
            type: 'property_fact',
            info: 'Tem piscina na cobertura.',
            confidence: 'high',
            is_isolated: false,
            property_name: 'Live Park',
          },
        ]),
      );

      await generateLearningSuggestions(db, 'account-1');
      expect(mocks.consolidateMemory).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ scope: 'property', propertyId: 'prop-live-park' }),
      );
      expect(inserted[0].status).toBe('approved');
    });

    it('does NOT auto-consolidate a PROPERTY fact when the property name is ambiguous — stays pending for a human to resolve', async () => {
      mocks.resolvePropertyIdentity.mockResolvedValue({
        kind: 'ambiguous',
        candidates: [{ propertyId: 'a', score: 0.7 }, { propertyId: 'b', score: 0.68 }],
      });
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          { type: 'property_fact', info: 'Tem piscina.', confidence: 'high', is_isolated: false, property_name: 'Live' },
        ]),
      );

      await generateLearningSuggestions(db, 'account-1');
      expect(mocks.consolidateMemory).not.toHaveBeenCalled();
      expect(inserted[0].status).toBe('pending');
    });

    it('does NOT auto-consolidate an AD fact when the ad_id was fabricated (not actually seen in this batch)', async () => {
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          {
            type: 'ad_fact',
            info: 'Fato de um anúncio inventado.',
            confidence: 'high',
            is_isolated: false,
            ad_id: 'ad-fabricado-999',
          },
        ]),
      );

      await generateLearningSuggestions(db, 'account-1');
      expect(mocks.consolidateMemory).not.toHaveBeenCalled();
      expect(inserted[0].status).toBe('pending');
    });

    it('leaves the suggestion pending when consolidateMemory declines the content as low-signal (memory: null)', async () => {
      mocks.consolidateMemory.mockResolvedValue({ action: 'skipped_low_signal', memory: null });
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          { type: 'business_rule', info: 'Não trabalhamos com terrenos.', confidence: 'high', is_isolated: false },
        ]),
      );

      await generateLearningSuggestions(db, 'account-1');
      expect(inserted[0].status).toBe('pending');
    });

    it('never routes language_style through consolidateMemory/ai_memories — it keeps its dedicated team_presentation approval path', async () => {
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          { type: 'language_style', info: 'Tom leve e informal do time.', confidence: 'high', is_isolated: false },
        ]),
      );

      await generateLearningSuggestions(db, 'account-1');
      expect(mocks.consolidateMemory).not.toHaveBeenCalled();
      expect(inserted[0].status).toBe('pending');
    });

    it('auto-consolidates a CONVERSATION fact, keying evidence off the resolved conversation_id', async () => {
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          {
            type: 'client_preference',
            info: 'Cliente quer para Airbnb.',
            confidence: 'high',
            is_isolated: false,
            conversation_id: 'conv-1',
          },
        ]),
      );

      await generateLearningSuggestions(db, 'account-1');
      expect(mocks.consolidateMemory).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          scope: 'conversation',
          conversationId: 'conv-1',
          evidence: { kind: 'conversation', conversationId: 'conv-1' },
        }),
      );
      expect(inserted[0].status).toBe('approved');
    });
  });

  it('does not re-suggest something already in the knowledge base', async () => {
    const { db, inserted } = fakeDb({
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

  // ============================================================
  // Scoped-memory context preservation and routing (2026-09-18 evolution)
  // ============================================================

  describe('context preservation in the scan prompt', () => {
    it('groups messages back into their real conversations and labels each speaker by name/role, never a flat anonymous timeline', async () => {
      const { db } = fakeDb({
        messages: [
          {
            conversation_id: 'conv-1',
            sender_type: 'customer',
            content_text: 'Oi, quero saber do Live Park.',
            created_at: '2026-01-01T10:00:00Z',
            property_name: 'Live Park',
          },
          {
            conversation_id: 'conv-1',
            sender_type: 'agent',
            sender_id: RONALDO_ID,
            content_text: 'Joiaaaa! Sou o Ronaldo, vou te ajudar.',
            created_at: '2026-01-01T10:01:00Z',
            property_name: 'Live Park',
          },
          {
            conversation_id: 'conv-2',
            sender_type: 'bot',
            content_text: 'Olá! Sou a Clara, assistente do Ronaldo Meira.',
            created_at: '2026-01-01T11:00:00Z',
          },
        ],
      });
      mocks.generateOpenAi.mockResolvedValue(scanResponse([]));

      await generateLearningSuggestions(db, 'account-1');

      const userPrompt = mocks.generateOpenAi.mock.calls[0][0].messages[0].content as string;
      expect(userPrompt).toContain('Conversa conv-1');
      expect(userPrompt).toContain('Empreendimento: Live Park');
      expect(userPrompt).toContain('[Ronaldo] Joiaaaa! Sou o Ronaldo, vou te ajudar.');
      expect(userPrompt).toContain('[Cliente] Oi, quero saber do Live Park.');
      expect(userPrompt).toContain('Conversa conv-2');
      expect(userPrompt).toContain('[Clara] Olá! Sou a Clara, assistente do Ronaldo Meira.');
    });

    it('never labels an unidentified agent (unknown sender_id) as a named corretor', async () => {
      const { db } = fakeDb({
        messages: [
          {
            conversation_id: 'conv-1',
            sender_type: 'agent',
            sender_id: 'someone-else',
            content_text: 'Mensagem de um atendente não cadastrado.',
            created_at: '2026-01-01T10:00:00Z',
          },
        ],
      });
      mocks.generateOpenAi.mockResolvedValue(scanResponse([]));
      await generateLearningSuggestions(db, 'account-1');
      const userPrompt = mocks.generateOpenAi.mock.calls[0][0].messages[0].content as string;
      expect(userPrompt).toContain('[Atendente] Mensagem de um atendente não cadastrado.');
      expect(userPrompt).not.toContain('[Ronaldo]');
      expect(userPrompt).not.toContain('[Thatianna]');
    });

    it('requests a larger output token budget and structured JSON for the learning scan', async () => {
      const { db } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(scanResponse([]));
      await generateLearningSuggestions(db, 'account-1');
      const callArgs = mocks.generateOpenAi.mock.calls[0][0];
      expect(callArgs.maxOutputTokens).toBeGreaterThan(1024);
      expect(callArgs.structuredOutputRequired).toBe(true);
    });
  });

  describe('scope routing for the new knowledge types', () => {
    it('tags a GLOBAL type (business_rule) with scope "global" and no target id', async () => {
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          { type: 'business_rule', info: 'Não trabalhamos com terrenos.', confidence: 'high', is_isolated: false },
        ]),
      );
      await generateLearningSuggestions(db, 'account-1');
      const payload = inserted[0].payload as Record<string, unknown>;
      expect(payload.scope).toBe('global');
      expect(payload.property_id).toBeNull();
    });

    it('resolves a PROPERTY type (property_fact) to a real property_id via resolvePropertyIdentity, when it safely matches', async () => {
      mocks.resolvePropertyIdentity.mockResolvedValue({ kind: 'safe_match', propertyId: 'prop-live-park', score: 0.99 });
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          {
            type: 'property_fact',
            info: 'Tem piscina na cobertura.',
            confidence: 'high',
            is_isolated: false,
            property_name: 'Live Park',
          },
        ]),
      );
      await generateLearningSuggestions(db, 'account-1');
      const payload = inserted[0].payload as Record<string, unknown>;
      expect(payload.scope).toBe('property');
      expect(payload.property_id).toBe('prop-live-park');
    });

    it('leaves property_id null for a PROPERTY type when identity resolution is ambiguous — never guesses', async () => {
      mocks.resolvePropertyIdentity.mockResolvedValue({
        kind: 'ambiguous',
        candidates: [{ propertyId: 'a', score: 0.7 }, { propertyId: 'b', score: 0.68 }],
      });
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          { type: 'property_fact', info: 'Tem piscina.', confidence: 'high', is_isolated: false, property_name: 'Live' },
        ]),
      );
      await generateLearningSuggestions(db, 'account-1');
      const payload = inserted[0].payload as Record<string, unknown>;
      expect(payload.property_id).toBeNull();
    });

    it('trusts an AD type only when the ad_id actually appeared in this batch (anti-hallucination guard)', async () => {
      const { db, inserted } = fakeDb({
        messages: [
          { ...BASE_MESSAGES[0], ad_source_id: 'ad-real-123' },
          BASE_MESSAGES[1],
        ],
      });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          {
            type: 'ad_fact',
            info: 'Este anúncio divulga unidade de 21m².',
            confidence: 'high',
            is_isolated: false,
            ad_id: 'ad-real-123',
          },
          {
            type: 'ad_fact',
            info: 'Fato de um anúncio inventado.',
            confidence: 'high',
            is_isolated: false,
            ad_id: 'ad-fabricado-999',
          },
        ]),
      );
      await generateLearningSuggestions(db, 'account-1');
      expect(inserted).toHaveLength(2);
      const real = inserted.find((r) => r.title === 'Este anúncio divulga unidade de 21m².');
      const fabricated = inserted.find((r) => r.title === 'Fato de um anúncio inventado.');
      expect((real?.payload as Record<string, unknown>).ad_id).toBe('ad-real-123');
      expect((fabricated?.payload as Record<string, unknown>).ad_id).toBeNull();
    });

    it('trusts a CONVERSATION type only when the conversation_id actually appeared in this batch, and carries its contact_id', async () => {
      const { db, inserted } = fakeDb({
        messages: [
          { ...BASE_MESSAGES[0], contact_id: 'contact-42' },
          { ...BASE_MESSAGES[1], contact_id: 'contact-42' },
        ],
      });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          {
            type: 'client_preference',
            info: 'Cliente quer para Airbnb.',
            confidence: 'high',
            is_isolated: false,
            conversation_id: 'conv-1',
          },
        ]),
      );
      await generateLearningSuggestions(db, 'account-1');
      const payload = inserted[0].payload as Record<string, unknown>;
      expect(payload.conversation_id).toBe('conv-1');
      expect(payload.contact_id).toBe('contact-42');
    });

    it('resolves agent_name to the matching profile — Ronaldo is never confused with Thatianna', async () => {
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          {
            type: 'language_style',
            info: 'Abre a conversa com "Joiaaaa".',
            confidence: 'high',
            is_isolated: false,
            agent_name: 'Ronaldo',
          },
          {
            type: 'communication_pattern',
            info: 'Usa "perfeito" para confirmar.',
            confidence: 'high',
            is_isolated: false,
            agent_name: 'Thatianna',
          },
        ]),
      );
      await generateLearningSuggestions(db, 'account-1');
      const ronaldoRow = inserted.find((r) => r.title === 'Abre a conversa com "Joiaaaa".');
      const tatiannaRow = inserted.find((r) => r.title === 'Usa "perfeito" para confirmar.');
      expect((ronaldoRow?.payload as Record<string, unknown>).agent_id).toBe(RONALDO_ID);
      expect((tatiannaRow?.payload as Record<string, unknown>).agent_id).toBe(TATIANNA_ID);
    });

    it('leaves agent_id null (team-wide) when agent_name is absent or does not match exactly one profile', async () => {
      const { db, inserted } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          { type: 'language_style', info: 'Tom leve e informal do time.', confidence: 'high', is_isolated: false },
        ]),
      );
      await generateLearningSuggestions(db, 'account-1');
      expect((inserted[0].payload as Record<string, unknown>).agent_id).toBeNull();
    });

    it('tags a batch that included a transcribed audio message so approval can attribute the memory to audio_transcript', async () => {
      const { db, inserted } = fakeDb({
        messages: [
          {
            conversation_id: 'conv-1',
            sender_type: 'agent',
            sender_id: RONALDO_ID,
            content_type: 'audio',
            transcript_text: 'Esse aqui tem vaga de garagem dupla, viu.',
            created_at: '2026-01-01T10:00:00Z',
          },
        ],
      });
      mocks.generateOpenAi.mockResolvedValue(
        scanResponse([
          { type: 'business_rule', info: 'Vagas duplas são um diferencial mencionado.', confidence: 'high', is_isolated: false },
        ]),
      );
      await generateLearningSuggestions(db, 'account-1');
      expect((inserted[0].payload as Record<string, unknown>).origin_includes_audio).toBe(true);
    });
  });

  describe('idempotent, backlog-safe cursor advancement (root-cause fix, 2026-09-18)', () => {
    it('advances the cursor to the LAST message actually read, never to "now" — so an overflow beyond the batch limit is read next run instead of skipped', async () => {
      const { db, updated } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue(scanResponse([]));
      await generateLearningSuggestions(db, 'account-1');
      const cursorUpdate = updated.find((u) => u.table === 'ai_configs');
      expect(cursorUpdate?.patch.learning_last_scanned_at).toBe('2026-01-01T10:01:00Z');
    });

    it('still advances the cursor when the model output fails to parse — never retries the same deterministically-failing window forever', async () => {
      const { db, updated } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockResolvedValue({ text: 'not valid json at all', usage: null });
      const result = await generateLearningSuggestions(db, 'account-1');
      expect(result).toEqual({ created: 0, touched: 0 });
      const cursorUpdate = updated.find((u) => u.table === 'ai_configs');
      expect(cursorUpdate?.patch.learning_last_scanned_at).toBe('2026-01-01T10:01:00Z');
    });

    it('does NOT advance the cursor when the provider call itself fails (transient error worth retrying against the same window)', async () => {
      const { db, updated } = fakeDb({ messages: BASE_MESSAGES });
      mocks.generateOpenAi.mockRejectedValue(new Error('network timeout'));
      const result = await generateLearningSuggestions(db, 'account-1');
      expect(result).toEqual({ created: 0, touched: 0 });
      expect(updated.some((u) => u.table === 'ai_configs')).toBe(false);
    });
  });
});
