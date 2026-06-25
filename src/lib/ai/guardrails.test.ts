import { describe, expect, it } from 'vitest';

import { shouldForceEscalate } from './guardrails';

// The seeded default keyword list from the spec (§4.1 / §7).
const DEFAULT_KEYWORDS = [
  'refund',
  'cancel',
  'complaint',
  'lawyer',
  'legal',
  'human',
  'agent',
  'manager',
];

describe('shouldForceEscalate — configured keywords', () => {
  it("escalates with reason 'keyword' on a whole-word match", () => {
    expect(
      shouldForceEscalate('I want a refund please', DEFAULT_KEYWORDS)
    ).toEqual({ escalate: true, reason: 'keyword' });
  });

  it('matches case-insensitively', () => {
    expect(shouldForceEscalate('REFUND NOW', DEFAULT_KEYWORDS).escalate).toBe(
      true
    );
    expect(
      shouldForceEscalate('Filing a CoMpLaInT', DEFAULT_KEYWORDS).escalate
    ).toBe(true);
  });

  it('anchors on word boundaries — no substring false positives', () => {
    // "legal" must not fire inside "illegal".
    expect(
      shouldForceEscalate('Is this illegal?', DEFAULT_KEYWORDS).escalate
    ).toBe(false);
    // "cancel" must not fire inside "cancellation" boundaries that are
    // still distinct words — but it DOES fire as its own word.
    expect(
      shouldForceEscalate('scancelled the order', DEFAULT_KEYWORDS).escalate
    ).toBe(false);
    // "agent" must not fire inside "agentic".
    expect(
      shouldForceEscalate('an agentic workflow', DEFAULT_KEYWORDS).escalate
    ).toBe(false);
  });

  it('matches a keyword adjacent to punctuation', () => {
    expect(shouldForceEscalate('refund, now!', DEFAULT_KEYWORDS).escalate).toBe(
      true
    );
    expect(
      shouldForceEscalate('Where is my refund?', DEFAULT_KEYWORDS).escalate
    ).toBe(true);
  });

  it('does not escalate on unrelated text', () => {
    expect(
      shouldForceEscalate('What are your opening hours?', DEFAULT_KEYWORDS)
    ).toEqual({ escalate: false });
  });

  it('matches a multi-word configured keyword across any whitespace', () => {
    expect(
      shouldForceEscalate('I have a billing  dispute', ['billing dispute'])
        .escalate
    ).toBe(true);
  });
});

describe('shouldForceEscalate — empty / malformed inputs', () => {
  it('does not escalate when the keyword list is empty (no explicit request)', () => {
    expect(shouldForceEscalate('what are your hours?', [])).toEqual({
      escalate: false,
    });
  });

  it('ignores blank / whitespace-only keywords (no match-everything bug)', () => {
    expect(shouldForceEscalate('hello there', ['', '   '])).toEqual({
      escalate: false,
    });
  });

  it('returns no-escalate for empty or whitespace-only inbound text', () => {
    expect(shouldForceEscalate('', DEFAULT_KEYWORDS)).toEqual({
      escalate: false,
    });
    expect(shouldForceEscalate('   ', DEFAULT_KEYWORDS)).toEqual({
      escalate: false,
    });
  });

  it('treats a non-array keyword argument as empty', () => {
    expect(
      shouldForceEscalate(
        'what are your hours?',
        undefined as unknown as string[]
      )
    ).toEqual({ escalate: false });
  });

  it('treats non-string inbound text as no-escalate', () => {
    expect(
      shouldForceEscalate(null as unknown as string, DEFAULT_KEYWORDS)
    ).toEqual({ escalate: false });
  });
});

describe('shouldForceEscalate — explicit human-request detection', () => {
  it("escalates on 'talk to a human' even with no configured keywords", () => {
    expect(shouldForceEscalate('I want to talk to a human', [])).toEqual({
      escalate: true,
      reason: 'keyword',
    });
  });

  it('detects a range of hand-off phrasings', () => {
    const phrases = [
      'Can I speak to a person?',
      'please connect me to an agent',
      'I need a real person',
      'let me talk to a representative',
      'transfer me to a manager',
      "I'd like a human agent",
      'get me customer service',
      'I want to speak with someone real',
    ];
    for (const text of phrases) {
      expect(shouldForceEscalate(text, []).escalate).toBe(true);
    }
  });

  it('is case-insensitive for human requests', () => {
    expect(shouldForceEscalate('TALK TO A HUMAN PLEASE', []).escalate).toBe(
      true
    );
  });

  it('does not escalate on a passing mention of a person without a request', () => {
    // No request verb paired with the noun → not an explicit hand-off.
    expect(
      shouldForceEscalate('your agent called me yesterday', []).escalate
    ).toBe(false);
    expect(shouldForceEscalate('the manager was very kind', []).escalate).toBe(
      false
    );
  });

  it('tolerates extra whitespace inside a request phrase', () => {
    expect(shouldForceEscalate('talk   to   a   human', []).escalate).toBe(
      true
    );
  });
});
