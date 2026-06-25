import { describe, it, expect } from 'vitest';

import { decide } from './decide';
import { type AiModelResult } from '@/types';

describe('decide — confident with an answer → reply', () => {
  it('replies with the answer text when confident and answer is non-empty', () => {
    const result: AiModelResult = {
      answer: "We're open 9am–5pm, Monday to Friday.",
      confident: true,
      reason: 'Opening hours are listed in the KB.',
    };
    expect(decide(result)).toEqual({
      action: 'reply',
      text: "We're open 9am–5pm, Monday to Friday.",
    });
  });

  it('passes the answer through verbatim (no trimming of the sent text)', () => {
    const result: AiModelResult = {
      answer: '  Sure — here you go.  ',
      confident: true,
      reason: 'answered',
    };
    expect(decide(result)).toEqual({
      action: 'reply',
      text: '  Sure — here you go.  ',
    });
  });

  it('does not leak a `reason` onto a reply result', () => {
    const decision = decide({
      answer: 'Yes, we ship to Kenya.',
      confident: true,
      reason: 'shipping coverage is in the KB',
    });
    expect(decision).not.toHaveProperty('reason');
  });
});

describe('decide — not confident → escalate', () => {
  it("escalates with reason 'low_confidence' when confident is false", () => {
    const result: AiModelResult = {
      answer: '',
      confident: false,
      reason: 'KB does not cover refund timelines.',
    };
    expect(decide(result)).toEqual({
      action: 'escalate',
      reason: 'low_confidence',
    });
  });

  it('escalates when not confident even if an answer was supplied', () => {
    // Belt-and-braces: a non-empty answer must NOT override a false
    // self-report — the model said it wasn't sure, so we don't send it.
    const result: AiModelResult = {
      answer: "I think it's probably 30 days?",
      confident: false,
      reason: 'guessing',
    };
    expect(decide(result)).toEqual({
      action: 'escalate',
      reason: 'low_confidence',
    });
  });
});

describe('decide — confident but empty answer → escalate', () => {
  it('escalates when confident but the answer is empty', () => {
    const result: AiModelResult = {
      answer: '',
      confident: true,
      reason: 'no content',
    };
    expect(decide(result)).toEqual({
      action: 'escalate',
      reason: 'low_confidence',
    });
  });

  it('escalates when confident but the answer is whitespace-only', () => {
    const result: AiModelResult = {
      answer: '   \n\t  ',
      confident: true,
      reason: 'blank',
    };
    expect(decide(result)).toEqual({
      action: 'escalate',
      reason: 'low_confidence',
    });
  });
});

describe('decide — malformed / degenerate input → escalate', () => {
  it('escalates when confident is a truthy non-true value (strict check)', () => {
    const result = {
      answer: 'Anything.',
      confident: 'yes',
      reason: 'string-not-boolean',
    } as unknown as AiModelResult;
    expect(decide(result)).toEqual({
      action: 'escalate',
      reason: 'low_confidence',
    });
  });

  it('escalates when answer is a non-string value', () => {
    const result = {
      answer: 42,
      confident: true,
      reason: 'answer-not-string',
    } as unknown as AiModelResult;
    expect(decide(result)).toEqual({
      action: 'escalate',
      reason: 'low_confidence',
    });
  });

  it('escalates safely on a null / undefined model result', () => {
    expect(decide(null as unknown as AiModelResult)).toEqual({
      action: 'escalate',
      reason: 'low_confidence',
    });
    expect(decide(undefined as unknown as AiModelResult)).toEqual({
      action: 'escalate',
      reason: 'low_confidence',
    });
  });
});

describe('decide — determinism / purity', () => {
  it('returns the same result for the same input and does not mutate it', () => {
    const result: AiModelResult = {
      answer: 'Hello!',
      confident: true,
      reason: 'greeting',
    };
    const snapshot = { ...result };
    const first = decide(result);
    const second = decide(result);
    expect(first).toEqual(second);
    expect(result).toEqual(snapshot);
  });
});
