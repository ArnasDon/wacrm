import { describe, it, expect } from 'vitest';
import {
  parseFollowupSteps,
  renderFollowupText,
  withinBusinessHours,
  nextDueFollowup,
  normalizeFollowupGoal,
  FOLLOWUP_MIN_MINUTES,
  FOLLOWUP_MAX_MINUTES,
  type FollowupStep,
} from './followups';

function step(over: Partial<FollowupStep> = {}): FollowupStep {
  return {
    after_minutes: 60,
    type: 'text',
    text: 'hola',
    template_name: '',
    template_language: '',
    ...over,
  };
}

describe('parseFollowupSteps', () => {
  it('treats null/undefined as an empty list', () => {
    expect(parseFollowupSteps(undefined)).toEqual({ ok: true, steps: [] });
    expect(parseFollowupSteps(null)).toEqual({ ok: true, steps: [] });
  });

  it('rejects a non-array', () => {
    expect(parseFollowupSteps({}).ok).toBe(false);
  });

  it('rejects more than 5 steps', () => {
    const many = Array.from({ length: 6 }, () => ({ after_minutes: 60, type: 'text', text: 'x' }));
    expect(parseFollowupSteps(many).ok).toBe(false);
  });

  it('clamps after_minutes into range', () => {
    const r = parseFollowupSteps([
      { after_minutes: 1, type: 'text', text: 'a' },
      { after_minutes: 9_999_999, type: 'text', text: 'b' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.steps[0].after_minutes).toBe(FOLLOWUP_MIN_MINUTES);
    expect(r.steps[1].after_minutes).toBe(FOLLOWUP_MAX_MINUTES);
  });

  it('requires text on a text step and a template on a template step', () => {
    expect(parseFollowupSteps([{ after_minutes: 60, type: 'text', text: '   ' }]).ok).toBe(false);
    expect(parseFollowupSteps([{ after_minutes: 60, type: 'template', template_name: '' }]).ok).toBe(
      false,
    );
    const ok = parseFollowupSteps([
      { after_minutes: 60, type: 'template', template_name: 'recordatorio', template_language: 'es' },
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.steps[0].text).toBe('');
  });

  it('rejects an over-long text body', () => {
    expect(
      parseFollowupSteps([{ after_minutes: 60, type: 'text', text: 'x'.repeat(1001) }]).ok,
    ).toBe(false);
  });
});

describe('normalizeFollowupGoal', () => {
  it('passes through the known goals', () => {
    for (const g of ['reply', 'appointment', 'deal_won', 'quote_sent']) {
      expect(normalizeFollowupGoal(g)).toBe(g);
    }
  });
  it('falls back to reply for anything else', () => {
    expect(normalizeFollowupGoal(undefined)).toBe('reply');
    expect(normalizeFollowupGoal(null)).toBe('reply');
    expect(normalizeFollowupGoal('')).toBe('reply');
    expect(normalizeFollowupGoal('sale')).toBe('reply');
    expect(normalizeFollowupGoal(42)).toBe('reply');
  });
});

describe('renderFollowupText', () => {
  it('substitutes the contact name', () => {
    expect(renderFollowupText('Hola {{nombre}}, ¿cómo estás?', { contactName: 'Ana López' })).toBe(
      'Hola Ana López, ¿cómo estás?',
    );
  });

  it('uses only the first name for {{first_name}}', () => {
    expect(renderFollowupText('Hola {{first_name}}', { contactName: 'Ana López' })).toBe('Hola Ana');
  });

  it('tidies up when there is no name', () => {
    expect(renderFollowupText('Hola {{nombre}}, ¿seguimos?', { contactName: null })).toBe(
      'Hola ¿seguimos?',
    );
  });
});

describe('withinBusinessHours', () => {
  // 2026-09-02T15:00:00Z === 09:00 in America/Guatemala (UTC-6)
  const nineLocal = new Date('2026-09-02T15:00:00Z');
  // 2026-09-02T05:00:00Z === 23:00 previous day in Guatemala
  const elevenPmLocal = new Date('2026-09-02T05:00:00Z');

  it('is open inside the window', () => {
    expect(withinBusinessHours(nineLocal, 'America/Guatemala', 8, 18)).toBe(true);
  });

  it('is closed outside the window', () => {
    expect(withinBusinessHours(elevenPmLocal, 'America/Guatemala', 8, 18)).toBe(false);
  });

  it('treats an equal start/end as always open', () => {
    expect(withinBusinessHours(elevenPmLocal, 'America/Guatemala', 0, 0)).toBe(true);
  });

  it('handles a window that wraps past midnight', () => {
    expect(withinBusinessHours(elevenPmLocal, 'America/Guatemala', 20, 6)).toBe(true);
    expect(withinBusinessHours(nineLocal, 'America/Guatemala', 20, 6)).toBe(false);
  });
});

describe('nextDueFollowup', () => {
  const tz = 'America/Guatemala';
  const base = {
    businessHoursOnly: false,
    windowStartHour: 0,
    windowEndHour: 0,
    timeZone: tz,
  };
  const lastCustomerAt = new Date('2026-09-02T15:00:00Z'); // 09:00 local

  it('returns nothing before the first delay elapses', () => {
    const now = new Date(lastCustomerAt.getTime() + 30 * 60_000);
    expect(
      nextDueFollowup({ ...base, steps: [step({ after_minutes: 60 })], lastCustomerAt, priorLog: [], now }),
    ).toBeNull();
  });

  it('returns step 0 once its delay elapses', () => {
    const now = new Date(lastCustomerAt.getTime() + 61 * 60_000);
    const due = nextDueFollowup({
      ...base,
      steps: [step({ after_minutes: 60 })],
      lastCustomerAt,
      priorLog: [],
      now,
    });
    expect(due?.stepIndex).toBe(0);
  });

  it('measures step 1 from the previous nudge, not the inbound', () => {
    const sentAt = new Date(lastCustomerAt.getTime() + 61 * 60_000);
    const steps = [step({ after_minutes: 60 }), step({ after_minutes: 120 })];
    // 90 min after the first nudge — not yet due
    let now = new Date(sentAt.getTime() + 90 * 60_000);
    expect(
      nextDueFollowup({ ...base, steps, lastCustomerAt, priorLog: [{ stepIndex: 0, sentAt }], now }),
    ).toBeNull();
    // 121 min after the first nudge — due
    now = new Date(sentAt.getTime() + 121 * 60_000);
    expect(
      nextDueFollowup({ ...base, steps, lastCustomerAt, priorLog: [{ stepIndex: 0, sentAt }], now })
        ?.stepIndex,
    ).toBe(1);
  });

  it('returns null when every step has been sent', () => {
    const sentAt = new Date(lastCustomerAt.getTime() + 61 * 60_000);
    expect(
      nextDueFollowup({
        ...base,
        steps: [step()],
        lastCustomerAt,
        priorLog: [{ stepIndex: 0, sentAt }],
        now: new Date(sentAt.getTime() + 10 * 24 * 3600_000),
      }),
    ).toBeNull();
  });

  it('skips a text step past the 24h WhatsApp window', () => {
    const now = new Date(lastCustomerAt.getTime() + 25 * 3600_000);
    expect(
      nextDueFollowup({
        ...base,
        steps: [step({ after_minutes: 60, type: 'text' })],
        lastCustomerAt,
        priorLog: [],
        now,
      }),
    ).toBeNull();
  });

  it('still allows a template step past 24h', () => {
    const now = new Date(lastCustomerAt.getTime() + 25 * 3600_000);
    const due = nextDueFollowup({
      ...base,
      steps: [step({ after_minutes: 60, type: 'template', template_name: 'recordatorio' })],
      lastCustomerAt,
      priorLog: [],
      now,
    });
    expect(due?.step.type).toBe('template');
  });

  it('holds a due nudge until business hours', () => {
    // now = 02:00 local (08:00Z), step due, but window is 08:00-18:00
    const lc = new Date('2026-09-02T05:00:00Z'); // 23:00 local prev day
    const now = new Date('2026-09-02T08:00:00Z'); // 02:00 local
    const args = {
      steps: [step({ after_minutes: 60 })],
      lastCustomerAt: lc,
      priorLog: [],
      now,
      businessHoursOnly: true,
      windowStartHour: 8,
      windowEndHour: 18,
      timeZone: tz,
    };
    expect(nextDueFollowup(args)).toBeNull();
    // …same streak, now 09:00 local (15:00Z) → released
    expect(
      nextDueFollowup({ ...args, now: new Date('2026-09-02T15:00:00Z') })?.stepIndex,
    ).toBe(0);
  });
});
