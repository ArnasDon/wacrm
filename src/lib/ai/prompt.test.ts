import { describe, expect, it } from 'vitest';

import {
  HISTORY_MESSAGE_LIMIT,
  buildMessages,
  buildSystemBlocks,
  type PromptHistoryMessage,
} from './prompt';
import { type AiAssistantConfig, type KnowledgeBaseEntry } from '@/types';

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

function makeConfig(
  overrides: Partial<AiAssistantConfig> = {}
): AiAssistantConfig {
  return {
    id: 'cfg-1',
    account_id: 'acct-A',
    enabled: true,
    system_prompt:
      'You are the support assistant for {business_name}. Answer only from the knowledge base.',
    escalation_keywords: [],
    business_name: 'Acme Co',
    model: 'claude-sonnet-4-6',
    daily_reply_cap: 500,
    created_at: '2026-06-25T00:00:00Z',
    updated_at: '2026-06-25T00:00:00Z',
    ...overrides,
  };
}

let kbSeq = 0;
function makeEntry(
  overrides: Partial<KnowledgeBaseEntry> = {}
): KnowledgeBaseEntry {
  kbSeq += 1;
  return {
    id: `kb-${kbSeq}`,
    account_id: 'acct-A',
    title: `Title ${kbSeq}`,
    content: `Content ${kbSeq}`,
    source_type: 'manual',
    enabled: true,
    created_at: '2026-06-25T00:00:00Z',
    updated_at: '2026-06-25T00:00:00Z',
    ...overrides,
  };
}

/** The single cache-marked block is always the KB block (index 1). */
function kbBlock(config: AiAssistantConfig, entries: KnowledgeBaseEntry[]) {
  return buildSystemBlocks(config, entries)[1];
}

// ------------------------------------------------------------------
// buildSystemBlocks — persona block
// ------------------------------------------------------------------

describe('buildSystemBlocks — persona block', () => {
  it('emits exactly two text blocks: persona then KB', () => {
    const blocks = buildSystemBlocks(makeConfig(), [makeEntry()]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('text');
    expect(blocks[1].type).toBe('text');
  });

  it('substitutes {business_name} into the persona prompt', () => {
    const blocks = buildSystemBlocks(
      makeConfig({ business_name: 'Globex' }),
      []
    );
    expect(blocks[0].text).toContain('Globex');
    expect(blocks[0].text).not.toContain('{business_name}');
  });

  it('replaces every {business_name} occurrence, not just the first', () => {
    const blocks = buildSystemBlocks(
      makeConfig({
        system_prompt: '{business_name} cares. Welcome to {business_name}.',
        business_name: 'Initech',
      }),
      []
    );
    expect(blocks[0].text).toBe('Initech cares. Welcome to Initech.');
  });

  it('falls back to a neutral name when business_name is missing/blank', () => {
    for (const business_name of [undefined, '', '   ']) {
      const blocks = buildSystemBlocks(makeConfig({ business_name }), []);
      expect(blocks[0].text).not.toContain('{business_name}');
      expect(blocks[0].text).toContain('our business');
    }
  });

  it('does NOT cache-mark the persona block (KB is the breakpoint)', () => {
    const blocks = buildSystemBlocks(makeConfig(), [makeEntry()]);
    expect(blocks[0].cache_control).toBeUndefined();
  });
});

// ------------------------------------------------------------------
// buildSystemBlocks — KB block assembly
// ------------------------------------------------------------------

describe('buildSystemBlocks — KB assembly', () => {
  it("renders each entry as '## {title}\\n{content}'", () => {
    const entry = makeEntry({ title: 'Refund policy', content: '30 days.' });
    const text = kbBlock(makeConfig(), [entry]).text;
    expect(text).toContain('## Refund policy\n30 days.');
  });

  it('wraps the KB in clear start/end delimiters', () => {
    const text = kbBlock(makeConfig(), [makeEntry()]).text;
    expect(text).toContain('KNOWLEDGE BASE (START)');
    expect(text).toContain('KNOWLEDGE BASE (END)');
    // Delimiters bracket the body.
    expect(text.indexOf('(START)')).toBeLessThan(text.indexOf('(END)'));
  });

  it('emits a non-empty, still-delimited block when there are no entries', () => {
    const text = kbBlock(makeConfig(), []).text;
    expect(text).toContain('KNOWLEDGE BASE (START)');
    expect(text).toContain('KNOWLEDGE BASE (END)');
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------
// buildSystemBlocks — cache_control placement (spec §7.2)
// ------------------------------------------------------------------

describe('buildSystemBlocks — cache_control placement', () => {
  it("marks the KB block with cache_control { type: 'ephemeral' }", () => {
    const block = kbBlock(makeConfig(), [makeEntry()]);
    expect(block.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('marks the KB block even when empty (stable cacheable prefix)', () => {
    expect(kbBlock(makeConfig(), []).cache_control).toEqual({
      type: 'ephemeral',
    });
  });

  it('places cache_control on exactly one block — the last (KB) one', () => {
    const blocks = buildSystemBlocks(makeConfig(), [makeEntry(), makeEntry()]);
    const marked = blocks.filter((b) => b.cache_control !== undefined);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(blocks[blocks.length - 1]);
  });
});

// ------------------------------------------------------------------
// Account isolation invariant (spec §7.4): only-and-all provided
// entries appear, in order. The function is blind to account_id.
// ------------------------------------------------------------------

describe('buildSystemBlocks — account isolation (only-and-all, in order)', () => {
  it('includes every provided enabled entry, in the order given', () => {
    const entries = [
      makeEntry({ title: 'A', content: 'alpha' }),
      makeEntry({ title: 'B', content: 'bravo' }),
      makeEntry({ title: 'C', content: 'charlie' }),
    ];
    const text = kbBlock(makeConfig(), entries).text;
    expect(text.indexOf('## A')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('## A')).toBeLessThan(text.indexOf('## B'));
    expect(text.indexOf('## B')).toBeLessThan(text.indexOf('## C'));
  });

  it('includes ONLY the provided entries — nothing else leaks in', () => {
    const entries = [
      makeEntry({ title: 'Hours', content: '9 to 5' }),
      makeEntry({ title: 'Shipping', content: 'Free over $50' }),
    ];
    const text = kbBlock(makeConfig(), entries).text;
    // Count the entry headers: exactly the two we supplied.
    expect(text.match(/^## /gm)).toHaveLength(2);
    expect(text).toContain('## Hours');
    expect(text).toContain('## Shipping');
  });

  it('does NOT filter, reorder, or dedup by account_id — it is account-blind', () => {
    // Two entries tagged with DIFFERENT account_ids. The caller is
    // responsible for pre-filtering; if it hands us a foreign-account
    // entry, we faithfully include it (and the caller's test catches the
    // leak upstream). This asserts the function adds no hidden filter
    // that could mask a caller bug, and preserves given order verbatim.
    const entries = [
      makeEntry({ account_id: 'acct-A', title: 'Mine', content: 'x' }),
      makeEntry({ account_id: 'acct-OTHER', title: 'Theirs', content: 'y' }),
    ];
    const text = kbBlock(makeConfig({ account_id: 'acct-A' }), entries).text;
    expect(text.match(/^## /gm)).toHaveLength(2);
    expect(text.indexOf('## Mine')).toBeLessThan(text.indexOf('## Theirs'));
  });

  it('excludes disabled entries but preserves the order of the rest', () => {
    const entries = [
      makeEntry({ title: 'One', enabled: true }),
      makeEntry({ title: 'Two', enabled: false }),
      makeEntry({ title: 'Three', enabled: true }),
    ];
    const text = kbBlock(makeConfig(), entries).text;
    expect(text).toContain('## One');
    expect(text).not.toContain('## Two');
    expect(text).toContain('## Three');
    expect(text.match(/^## /gm)).toHaveLength(2);
    expect(text.indexOf('## One')).toBeLessThan(text.indexOf('## Three'));
  });
});

// ------------------------------------------------------------------
// buildMessages — role mapping & ordering (spec §7.3)
// ------------------------------------------------------------------

describe('buildMessages — role mapping & ordering', () => {
  it('maps customer→user and agent/bot→assistant, oldest→newest, then appends inbound', () => {
    const history: PromptHistoryMessage[] = [
      { sender_type: 'customer', content_text: 'hi' },
      { sender_type: 'bot', content_text: 'hello, how can I help?' },
      { sender_type: 'agent', content_text: 'this is a human agent' },
    ];
    expect(buildMessages(history, 'what are your hours?')).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello, how can I help?' },
      { role: 'assistant', content: 'this is a human agent' },
      { role: 'user', content: 'what are your hours?' },
    ]);
  });

  it('always appends the inbound text as the final user turn', () => {
    const result = buildMessages([], 'first contact');
    expect(result).toEqual([{ role: 'user', content: 'first contact' }]);
  });

  it('preserves history order verbatim (no sorting)', () => {
    const history: PromptHistoryMessage[] = [
      { sender_type: 'customer', content_text: 'msg-1' },
      { sender_type: 'customer', content_text: 'msg-2' },
      { sender_type: 'customer', content_text: 'msg-3' },
    ];
    const contents = buildMessages(history, 'msg-4').map((m) => m.content);
    expect(contents).toEqual(['msg-1', 'msg-2', 'msg-3', 'msg-4']);
  });

  it('drops history turns with empty/blank/missing text', () => {
    const history: PromptHistoryMessage[] = [
      { sender_type: 'customer', content_text: 'keep me' },
      { sender_type: 'bot', content_text: '' },
      { sender_type: 'bot', content_text: '   ' },
      { sender_type: 'customer', content_text: null },
      { sender_type: 'customer' },
    ];
    expect(buildMessages(history, 'inbound')).toEqual([
      { role: 'user', content: 'keep me' },
      { role: 'user', content: 'inbound' },
    ]);
  });

  it('treats a non-array history as empty', () => {
    expect(
      buildMessages(undefined as unknown as PromptHistoryMessage[], 'hi')
    ).toEqual([{ role: 'user', content: 'hi' }]);
  });
});

// ------------------------------------------------------------------
// buildMessages — history cap (spec §7.3 / §13)
// ------------------------------------------------------------------

describe('buildMessages — history cap', () => {
  it('keeps only the last HISTORY_MESSAGE_LIMIT history turns + the inbound', () => {
    const history: PromptHistoryMessage[] = Array.from(
      { length: 25 },
      (_unused, i) => ({
        sender_type: 'customer' as const,
        content_text: `h${i}`,
      })
    );

    const result = buildMessages(history, 'INBOUND');

    // N history turns + the appended inbound.
    expect(result).toHaveLength(HISTORY_MESSAGE_LIMIT + 1);
    // The kept turns are the most-recent N (h15..h24), in order.
    expect(result[0].content).toBe(`h${25 - HISTORY_MESSAGE_LIMIT}`);
    expect(result[HISTORY_MESSAGE_LIMIT - 1].content).toBe('h24');
    // Inbound is last.
    expect(result[result.length - 1]).toEqual({
      role: 'user',
      content: 'INBOUND',
    });
  });

  it('applies the cap AFTER dropping blank turns (caps real turns only)', () => {
    // 12 real turns interleaved with blanks. After dropping blanks we
    // have 12 usable; the cap keeps the last 10 of those.
    const history: PromptHistoryMessage[] = [];
    for (let i = 0; i < 12; i += 1) {
      history.push({ sender_type: 'customer', content_text: `real-${i}` });
      history.push({ sender_type: 'bot', content_text: '  ' }); // blank
    }

    const result = buildMessages(history, 'INBOUND');

    expect(result).toHaveLength(HISTORY_MESSAGE_LIMIT + 1);
    expect(result[0].content).toBe('real-2'); // 12 real, last 10 → real-2..real-11
    expect(result[HISTORY_MESSAGE_LIMIT - 1].content).toBe('real-11');
  });

  it('does not pad when history is shorter than the cap', () => {
    const history: PromptHistoryMessage[] = [
      { sender_type: 'customer', content_text: 'only one' },
    ];
    expect(buildMessages(history, 'two')).toHaveLength(2);
  });
});
