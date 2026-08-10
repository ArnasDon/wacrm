import { describe, expect, it } from 'vitest';
import { parseLearningScanResult } from './learning-types';

describe('parseLearningScanResult', () => {
  it('parses a well-formed learnings array', () => {
    const raw = JSON.stringify({
      learnings: [
        {
          type: 'commercial_rule',
          info: 'Entrada de 20% é aceita para lançamentos.',
          context_summary: 'Mencionado em várias negociações.',
          application: 'Usar como referência ao negociar entrada.',
          occurrence_count: 3,
          confidence: 'high',
          is_isolated: false,
        },
      ],
    });
    const result = parseLearningScanResult(raw);
    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({
      type: 'commercial_rule',
      info: 'Entrada de 20% é aceita para lançamentos.',
      occurrence_count: 3,
      confidence: 'high',
      is_isolated: false,
    });
  });

  it('also accepts a bare array (no wrapping object)', () => {
    const raw = JSON.stringify([{ info: 'x', is_isolated: false, confidence: 'high' }]);
    expect(parseLearningScanResult(raw)).toHaveLength(1);
  });

  it('drops an entry with no info', () => {
    const raw = JSON.stringify({ learnings: [{ is_isolated: false }] });
    expect(parseLearningScanResult(raw)).toEqual([]);
  });

  it('defaults an unknown type to "other" and unknown confidence to "low"', () => {
    const raw = JSON.stringify({
      learnings: [{ info: 'x', type: 'made_up', confidence: 'sure', is_isolated: false }],
    });
    const result = parseLearningScanResult(raw);
    expect(result?.[0].type).toBe('other');
    expect(result?.[0].confidence).toBe('low');
  });

  it('fails safe: an unclear is_isolated defaults to true (isolated)', () => {
    const raw = JSON.stringify({ learnings: [{ info: 'x', confidence: 'high' }] });
    expect(parseLearningScanResult(raw)?.[0].is_isolated).toBe(true);
  });

  it('returns an empty array (not null) when the model found nothing', () => {
    const raw = JSON.stringify({ learnings: [] });
    expect(parseLearningScanResult(raw)).toEqual([]);
  });

  it('returns null for unparseable output', () => {
    expect(parseLearningScanResult('not json')).toBeNull();
  });

  it('strips a markdown code fence', () => {
    const raw = '```json\n{"learnings":[]}\n```';
    expect(parseLearningScanResult(raw)).toEqual([]);
  });
});
