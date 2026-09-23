import { describe, it, expect } from 'vitest';
import { decideFallback, resolveFallbackPolicy } from './fallback';
import { DEFAULT_FALLBACK_POLICY, type FlowFallbackPolicy } from './types';

describe('resolveFallbackPolicy', () => {
  it('returns defaults for null / undefined / non-object', () => {
    expect(resolveFallbackPolicy(null)).toEqual(DEFAULT_FALLBACK_POLICY);
    expect(resolveFallbackPolicy(undefined)).toEqual(DEFAULT_FALLBACK_POLICY);
    expect(resolveFallbackPolicy('not-an-object')).toEqual(
      DEFAULT_FALLBACK_POLICY
    );
    expect(resolveFallbackPolicy(42)).toEqual(DEFAULT_FALLBACK_POLICY);
  });

  it('returns defaults for an empty object', () => {
    expect(resolveFallbackPolicy({})).toEqual(DEFAULT_FALLBACK_POLICY);
  });

  it('preserves valid fields, defaults the rest', () => {
    expect(
      resolveFallbackPolicy({ max_reprompts: 5, on_exhaust: 'end' })
    ).toEqual({
      ...DEFAULT_FALLBACK_POLICY,
      max_reprompts: 5,
      on_exhaust: 'end',
    });
  });

  it('rejects invalid on_unknown_reply values', () => {
    expect(
      resolveFallbackPolicy({ on_unknown_reply: 'nonsense' as unknown })
    ).toEqual(DEFAULT_FALLBACK_POLICY);
  });

  it('rejects negative or NaN max_reprompts', () => {
    expect(resolveFallbackPolicy({ max_reprompts: -1 })).toEqual(
      DEFAULT_FALLBACK_POLICY
    );
    expect(resolveFallbackPolicy({ max_reprompts: Number.NaN })).toEqual(
      DEFAULT_FALLBACK_POLICY
    );
  });

  it('floors non-integer max_reprompts to be safe', () => {
    expect(resolveFallbackPolicy({ max_reprompts: 2.7 }).max_reprompts).toBe(2);
  });

  it('rejects non-positive on_timeout_hours', () => {
    expect(resolveFallbackPolicy({ on_timeout_hours: 0 })).toEqual(
      DEFAULT_FALLBACK_POLICY
    );
    expect(resolveFallbackPolicy({ on_timeout_hours: -5 })).toEqual(
      DEFAULT_FALLBACK_POLICY
    );
  });
});

const POLICY_REPROMPT_2_HANDOFF: FlowFallbackPolicy = {
  on_unknown_reply: 'reprompt',
  max_reprompts: 2,
  on_timeout_hours: 24,
  on_exhaust: 'handoff',
};

describe('decideFallback', () => {
  it("returns ignore when on_unknown_reply is 'ignore'", () => {
    expect(
      decideFallback({
        policy: { ...POLICY_REPROMPT_2_HANDOFF, on_unknown_reply: 'ignore' },
        reprompt_count: 1,
      })
    ).toEqual({ type: 'ignore' });
  });

  it("returns handoff immediately when on_unknown_reply is 'handoff'", () => {
    expect(
      decideFallback({
        policy: { ...POLICY_REPROMPT_2_HANDOFF, on_unknown_reply: 'handoff' },
        reprompt_count: 1,
      })
    ).toEqual({ type: 'handoff' });
  });

  it('reprompts up to max_reprompts', () => {
    // count=1 (first reprompt) and count=2 (second) still re-prompt
    expect(
      decideFallback({ policy: POLICY_REPROMPT_2_HANDOFF, reprompt_count: 1 })
    ).toEqual({ type: 'reprompt' });
    expect(
      decideFallback({ policy: POLICY_REPROMPT_2_HANDOFF, reprompt_count: 2 })
    ).toEqual({ type: 'reprompt' });
  });

  it('escalates to handoff once max_reprompts is exceeded', () => {
    // count=3 with max=2 → exhaust → handoff
    expect(
      decideFallback({ policy: POLICY_REPROMPT_2_HANDOFF, reprompt_count: 3 })
    ).toEqual({ type: 'handoff' });
  });

  it("respects on_exhaust='end' when max is exhausted", () => {
    const policy: FlowFallbackPolicy = {
      ...POLICY_REPROMPT_2_HANDOFF,
      on_exhaust: 'end',
    };
    expect(decideFallback({ policy, reprompt_count: 5 })).toEqual({
      type: 'end',
    });
  });

  it('with max_reprompts=0, the first unknown reply exhausts', () => {
    const policy: FlowFallbackPolicy = {
      ...POLICY_REPROMPT_2_HANDOFF,
      max_reprompts: 0,
    };
    // count=1 already > max=0 → exhaust
    expect(decideFallback({ policy, reprompt_count: 1 })).toEqual({
      type: 'handoff',
    });
  });
});
