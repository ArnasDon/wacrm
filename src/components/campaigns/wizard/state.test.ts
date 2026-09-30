import { describe, expect, it } from 'vitest';

import type { Channel } from '@/components/whatsapp/channel-types';
import type { MessageTemplate } from '@/types';
import {
  buildCampaignPayload,
  draftProblems,
  initialState,
  type WizardState,
} from './state';

const channel = (id: string, over: Partial<Channel> = {}) =>
  ({
    id,
    name: id,
    waba_id: 'w1',
    status: 'connected',
    phone_number_id: `pn-${id}`,
    ...over,
  }) as Channel;
const tpl = (name: string, body = 'Hi {{1}}') =>
  ({
    id: name,
    name,
    language: 'en_US',
    status: 'APPROVED',
    waba_id: 'w1',
    body_text: body,
  }) as unknown as MessageTemplate;

function readyDraft(): WizardState {
  const s = initialState('advanced', 'Diwali offer');
  return {
    ...s,
    channelIds: ['c1'],
    channelTemplates: { c1: [{ name: 'promo', language: 'en_US' }] },
    shared: { body: { '1': { type: 'column', value: 'name' } } },
    audience: {
      ...s.audience,
      source: 'csv',
      phoneColumn: 'phone',
      nameColumn: 'name',
      csv: {
        headers: ['phone', 'name', 'city'],
        rows: [
          ['+919800000001', 'Asha', 'Pune'],
          ['+919800000001', 'Asha again', 'Pune'], // duplicate
          ['not a phone', 'X', 'Y'], // invalid
          ['+919800000002', 'Ravi', 'Delhi'],
        ],
      },
    } as WizardState['audience'],
    draftId: 'draft-1',
  };
}

describe('draftProblems', () => {
  it('a complete draft has none', () => {
    expect(
      draftProblems(readyDraft(), [channel('c1')], [tpl('promo')])
    ).toEqual([]);
  });

  it('flags each missing piece', () => {
    const s = readyDraft();
    expect(
      draftProblems({ ...s, name: ' ' }, [channel('c1')], [tpl('promo')])
    ).toContain('name');
    expect(
      draftProblems(
        s,
        [channel('c1', { status: 'disconnected' } as Partial<Channel>)],
        [tpl('promo')]
      )
    ).toContain('channels');
    expect(draftProblems(s, [channel('c1')], [])).toContain('templates');
    expect(
      draftProblems(
        { ...s, shared: { body: {} } },
        [channel('c1')],
        [tpl('promo')]
      )
    ).toContain('variables');
    expect(
      draftProblems(
        { ...s, audience: { ...s.audience, csv: null } },
        [channel('c1')],
        [tpl('promo')]
      )
    ).toContain('audience'); // CSV too big to keep in the draft
  });
});

describe('buildCampaignPayload', () => {
  it('sends the valid, de-duplicated rows with only the columns used, and the draft id', () => {
    const p = buildCampaignPayload(readyDraft(), [tpl('promo')], {
      mode: 'now',
    });
    expect(p.name).toBe('Diwali offer');
    expect(p.channel_ids).toEqual(['c1']);
    expect(p.draft_id).toBe('draft-1'); // the API replaces the draft
    expect(p.schedule).toEqual({ mode: 'now' });
    expect(p.audience.rows).toEqual([
      { phone: '+919800000001', name: 'Asha' },
      { phone: '+919800000002', name: 'Ravi' },
    ]);
    expect(p.mappings['promo:en_US'].body?.['1']).toEqual({
      type: 'column',
      value: 'name',
    });
  });

  it('carries a schedule', () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      buildCampaignPayload(readyDraft(), [tpl('promo')], { mode: 'later', at })
        .schedule
    ).toEqual({ mode: 'later', at });
  });
});
