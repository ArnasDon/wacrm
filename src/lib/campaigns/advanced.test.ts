import { describe, expect, it } from 'vitest';

import {
  campaignTemplateUses,
  guessColumn,
  isTemplateUnavailable,
  normalizeCsvPhone,
  parseCsvTable,
  referencedColumns,
  resolveSendParams,
  templateSlots,
} from './advanced';

describe('parseCsvTable', () => {
  it('handles quotes, embedded commas/newlines, CRLF and a BOM', () => {
    const csv =
      '﻿Phone,Name,Note\r\n+911234567890,"Doe, Jane","line1\nline2"\r\n\r\n919876543210,Raj,"say ""hi"""\r\n';
    const { headers, rows } = parseCsvTable(csv);
    expect(headers).toEqual(['Phone', 'Name', 'Note']);
    expect(rows).toEqual([
      ['+911234567890', 'Doe, Jane', 'line1\nline2'],
      ['919876543210', 'Raj', 'say "hi"'],
    ]);
  });

  it('sniffs semicolons and names blank / duplicate headers', () => {
    const { headers, rows } = parseCsvTable('mobile;name;;name\n1;a;b;c');
    expect(headers).toEqual(['mobile', 'name', 'Column 3', 'name (2)']);
    expect(rows[0]).toEqual(['1', 'a', 'b', 'c']);
  });

  it('pads short rows', () => {
    expect(parseCsvTable('a,b,c\n1').rows).toEqual([['1', '', '']]);
  });
});

describe('guessColumn', () => {
  it('prefers exact names, then fuzzy matches', () => {
    expect(guessColumn(['Customer', 'Mobile No', 'City'], 'phone')).toBe(
      'Mobile No'
    );
    expect(guessColumn(['First Name', 'Name'], 'name')).toBe('Name');
    expect(guessColumn(['a', 'b'], 'phone')).toBeNull();
  });
});

describe('normalizeCsvPhone', () => {
  it('takes + and 00 numbers as written', () => {
    expect(normalizeCsvPhone('+91 98123-45678')).toBe('919812345678');
    expect(normalizeCsvPhone('0091 9812345678')).toBe('919812345678');
  });

  it('without a country code, digits must already include it', () => {
    expect(normalizeCsvPhone('919812345678')).toBe('919812345678');
    expect(normalizeCsvPhone('12345')).toBeNull();
  });

  it('prefixes the country code to national numbers, dropping a trunk 0', () => {
    expect(normalizeCsvPhone('09812345678', '91')).toBe('919812345678');
    expect(normalizeCsvPhone('9812345678', '91')).toBe('919812345678');
    // Already carries the code.
    expect(normalizeCsvPhone('919812345678', '91')).toBe('919812345678');
    // A + number ignores the default code.
    expect(normalizeCsvPhone('+14155550123', '91')).toBe('14155550123');
  });

  it('rejects empty and junk', () => {
    expect(normalizeCsvPhone('')).toBeNull();
    expect(normalizeCsvPhone('n/a')).toBeNull();
  });
});

const template = {
  body_text: 'Hi {{1}}, your order {{2}} ships today',
  header_type: 'text' as const,
  header_content: 'Order {{1}}',
  buttons: [
    { type: 'QUICK_REPLY' as const, text: 'Stop' },
    { type: 'URL' as const, text: 'Track', url: 'https://x.test/t/{{1}}' },
  ],
};

describe('templateSlots / resolveSendParams', () => {
  it('lists every per-send value a template needs', () => {
    expect(templateSlots(template)).toEqual({
      body: [1, 2],
      headerText: true,
      headerMedia: null,
      urlButtons: [1],
    });
  });

  it('fills from columns and fixed text', () => {
    const params = resolveSendParams(
      template,
      {
        body: {
          '1': { type: 'column', value: 'Name' },
          '2': { type: 'static', value: 'A-1' },
        },
        header_text: { type: 'column', value: 'Order' },
        buttons: { '1': { type: 'column', value: 'Order' } },
      },
      { Name: 'Asha', Order: '778' }
    );
    expect(params).toEqual({
      body: ['Asha', 'A-1'],
      headerText: '778',
      buttonParams: { 1: '778' },
    });
  });

  it('names the variable that is empty for a row', () => {
    expect(() =>
      resolveSendParams(
        { body_text: 'Hi {{1}}' },
        { body: { '1': { type: 'column', value: 'Name' } } },
        { Name: '  ' }
      )
    ).toThrow('{{1}}');
  });

  it('passes a media header link through', () => {
    const params = resolveSendParams(
      { body_text: 'Hello', header_type: 'image' },
      { body: {}, header_media_url: ' https://cdn.test/a.jpg ' },
      {}
    );
    expect(params).toEqual({ headerMediaUrl: 'https://cdn.test/a.jpg' });
  });
});

describe('referencedColumns', () => {
  it('collects the name column and every mapped column once', () => {
    expect(
      referencedColumns({
        name_column: 'Name',
        mappings: {
          'a:en': {
            body: {
              '1': { type: 'column', value: 'Name' },
              '2': { type: 'static', value: 'x' },
            },
          },
          'b:en': {
            body: { '1': { type: 'column', value: 'City' } },
            header_text: { type: 'column', value: 'Code' },
          },
        },
      }).sort()
    ).toEqual(['City', 'Code', 'Name']);
  });
});

describe('isTemplateUnavailable', () => {
  it('matches pause / disable / missing template codes', () => {
    expect(isTemplateUnavailable(132015)).toBe(true);
    expect(isTemplateUnavailable(132016)).toBe(true);
    expect(isTemplateUnavailable(132001)).toBe(true);
    expect(isTemplateUnavailable(131049)).toBe(false);
    expect(isTemplateUnavailable(null, 'Template is paused')).toBe(true);
  });
});

describe('campaignTemplateUses', () => {
  const tpl = { name: 'missed_call_reschedule', language: 'en_US' };
  const config = {
    channel_ids: ['a', 'b'],
    templates: [tpl],
    channel_templates: { a: [tpl], b: [tpl] },
  };

  it('same-named templates on two Meta accounts are two templates', () => {
    const uses = campaignTemplateUses(config, [
      { id: 'a', waba_id: 'w1' },
      { id: 'b', waba_id: 'w2' },
    ]);
    expect(uses).toHaveLength(2);
    expect(uses.map((u) => u.channelIds)).toEqual([['a'], ['b']]);
  });

  it('channels on one Meta account share the template', () => {
    const uses = campaignTemplateUses(config, [
      { id: 'a', waba_id: 'w1' },
      { id: 'b', waba_id: 'w1' },
    ]);
    expect(uses).toHaveLength(1);
    expect(uses[0].channelIds).toEqual(['a', 'b']);
  });

  it("counts each channel's own templates (fallback: the shared list)", () => {
    const uses = campaignTemplateUses(
      {
        channel_ids: ['a', 'b'],
        templates: [tpl, { name: 'promo', language: 'en_US' }],
        channel_templates: { a: [tpl] },
      },
      [{ id: 'a', waba_id: 'w1' }]
    );
    // a: 1 template; b (unknown account, no own list): both shared ones.
    expect(uses).toHaveLength(3);
  });
});
