import { describe, expect, it } from 'vitest';
import { parseFollowupScoreResult } from './followup-types';

describe('parseFollowupScoreResult', () => {
  it('parses a well-formed suggest=true response', () => {
    const raw = JSON.stringify({
      should_suggest: true,
      reason: 'Perguntou condições e sumiu há 3 dias.',
      approach_summary: 'Retomar oferecendo as condições que faltaram.',
      score: 78,
    });
    expect(parseFollowupScoreResult(raw)).toEqual({
      should_suggest: true,
      reason: 'Perguntou condições e sumiu há 3 dias.',
      approach_summary: 'Retomar oferecendo as condições que faltaram.',
      score: 78,
    });
  });

  it('normalizes should_suggest=false to the empty shape regardless of other fields', () => {
    const raw = JSON.stringify({ should_suggest: false, reason: 'x', score: 90 });
    expect(parseFollowupScoreResult(raw)).toEqual({
      should_suggest: false,
      reason: null,
      approach_summary: null,
      score: null,
    });
  });

  it('treats a missing score as should_suggest=false', () => {
    const raw = JSON.stringify({ should_suggest: true, reason: 'x' });
    expect(parseFollowupScoreResult(raw)?.should_suggest).toBe(false);
  });

  it('treats a missing reason as should_suggest=false', () => {
    const raw = JSON.stringify({ should_suggest: true, score: 80 });
    expect(parseFollowupScoreResult(raw)?.should_suggest).toBe(false);
  });

  it('clamps an out-of-range score into 0-100', () => {
    const raw = JSON.stringify({ should_suggest: true, reason: 'x', score: 140 });
    expect(parseFollowupScoreResult(raw)?.score).toBe(100);
  });

  it('strips a markdown code fence', () => {
    const raw = '```json\n{"should_suggest":false}\n```';
    expect(parseFollowupScoreResult(raw)).not.toBeNull();
  });

  it('returns null for unparseable output', () => {
    expect(parseFollowupScoreResult('not json at all')).toBeNull();
  });
});
