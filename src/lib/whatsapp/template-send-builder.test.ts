import { describe, expect, it } from 'vitest';
import { buildSendComponents } from './template-send-builder';
import type { MessageTemplate } from '@/types';

function row(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: 'row-1',
    user_id: 'user-1',
    name: 'order_confirmation',
    category: 'Utility',
    language: 'en_US',
    body_text: 'Your order is on its way.',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildSendComponents — body', () => {
  it('returns [] for a fully-static template (no vars, no media header)', () => {
    expect(buildSendComponents(row())).toEqual([]);
  });

  it('emits a body component when the template has variables', () => {
    const components = buildSendComponents(
      row({ body_text: 'Hi {{1}}, order {{2}} confirmed.' }),
      { body: ['John', 'ORD-42'] }
    );
    expect(components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'John' },
          { type: 'text', text: 'ORD-42' },
        ],
      },
    ]);
  });

  it('throws when body has variables but caller supplied too few values', () => {
    expect(() =>
      buildSendComponents(row({ body_text: 'Hi {{1}} {{2}}' }), {
        body: ['just one'],
      })
    ).toThrow(/2 variable\(s\) but only 1/);
  });

  it('trims extra body values silently (legacy callers may overshoot)', () => {
    const components = buildSendComponents(row({ body_text: 'Hi {{1}}' }), {
      body: ['John', 'extra', 'extra2'],
    });
    expect(components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'John' }] },
    ]);
  });
});

describe('buildSendComponents — header', () => {
  it('skips static TEXT headers (template carries them)', () => {
    expect(
      buildSendComponents(
        row({ header_type: 'text', header_content: 'Order Confirmation' })
      )
    ).toEqual([]);
  });

  it('emits a TEXT header component when {{1}} is present', () => {
    const components = buildSendComponents(
      row({ header_type: 'text', header_content: 'Hello {{1}}' }),
      { headerText: 'Sara' }
    );
    expect(components).toEqual([
      { type: 'header', parameters: [{ type: 'text', text: 'Sara' }] },
    ]);
  });

  it('throws when TEXT header has {{1}} but no value was supplied', () => {
    expect(() =>
      buildSendComponents(
        row({ header_type: 'text', header_content: 'Hello {{1}}' })
      )
    ).toThrow(/Header text variable \{\{1\}\}/);
  });

  it('auto-includes IMAGE header from the stored sample URL', () => {
    const components = buildSendComponents(
      row({
        header_type: 'image',
        header_media_url: 'https://example.com/sample.jpg',
      })
    );
    expect(components).toEqual([
      {
        type: 'header',
        parameters: [
          { type: 'image', image: { link: 'https://example.com/sample.jpg' } },
        ],
      },
    ]);
  });

  it('prefers caller override URL over template sample', () => {
    const components = buildSendComponents(
      row({
        header_type: 'video',
        header_media_url: 'https://example.com/default.mp4',
      }),
      { headerMediaUrl: 'https://example.com/custom.mp4' }
    );
    expect(components[0]).toEqual({
      type: 'header',
      parameters: [
        { type: 'video', video: { link: 'https://example.com/custom.mp4' } },
      ],
    });
  });

  it('does NOT use the resumable header_handle at send — falls back to the stored link', () => {
    // header_handle is a template-CREATION sample handle, invalid as a
    // send-time media id. The send must use the public link instead.
    const components = buildSendComponents(
      row({
        header_type: 'document',
        header_handle: '4::aBc',
        header_media_url: 'https://x.com/doc.pdf',
      })
    );
    expect(components[0]).toEqual({
      type: 'header',
      parameters: [
        { type: 'document', document: { link: 'https://x.com/doc.pdf' } },
      ],
    });
  });

  it('uses an explicit headerMediaId override as the media id', () => {
    const components = buildSendComponents(
      row({ header_type: 'image', header_media_url: 'https://x.com/s.jpg' }),
      { headerMediaId: '9:realMediaId' }
    );
    expect(components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { id: '9:realMediaId' } }],
    });
  });

  it('throws on media header with no link OR id available', () => {
    expect(() => buildSendComponents(row({ header_type: 'image' }))).toThrow(
      /requires a media link or id/
    );
  });
});

describe('buildSendComponents — buttons', () => {
  it('omits URL buttons without variables (template carries the URL)', () => {
    const components = buildSendComponents(
      row({
        buttons: [{ type: 'URL', text: 'Visit', url: 'https://example.com' }],
      })
    );
    expect(components).toEqual([]);
  });

  it('emits a URL button component when the URL has {{1}}', () => {
    const components = buildSendComponents(
      row({
        buttons: [{ type: 'URL', text: 'Track', url: 'https://x.com/{{1}}' }],
      }),
      { buttonParams: { 0: 'ORD-42' } }
    );
    expect(components).toEqual([
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: 'ORD-42' }],
      },
    ]);
  });

  it('throws when URL button has {{1}} but no buttonParam was provided', () => {
    expect(() =>
      buildSendComponents(
        row({
          buttons: [{ type: 'URL', text: 'Track', url: 'https://x.com/{{1}}' }],
        })
      )
    ).toThrow(/URL button #1 uses \{\{1\}\}/);
  });

  it('uses the correct index when QR buttons precede the URL button', () => {
    // sub_type:url at index "2" because two QUICK_REPLY buttons came first.
    const components = buildSendComponents(
      row({
        buttons: [
          { type: 'QUICK_REPLY', text: 'Yes' },
          { type: 'QUICK_REPLY', text: 'No' },
          { type: 'URL', text: 'Open', url: 'https://x.com/{{1}}' },
        ],
      }),
      { buttonParams: { 2: 'ORD-42' } }
    );
    const urlBtn = components.find((c) => c.type === 'button');
    expect(urlBtn).toEqual({
      type: 'button',
      sub_type: 'url',
      index: '2',
      parameters: [{ type: 'text', text: 'ORD-42' }],
    });
  });

  it('falls back to the template example for COPY_CODE buttons', () => {
    const components = buildSendComponents(
      row({
        buttons: [{ type: 'COPY_CODE', text: 'Copy', example: 'SUMMER20' }],
      })
    );
    expect(components).toEqual([
      {
        type: 'button',
        sub_type: 'copy_code',
        index: '0',
        parameters: [{ type: 'coupon_code', coupon_code: 'SUMMER20' }],
      },
    ]);
  });

  it('overrides COPY_CODE code when caller supplies one', () => {
    const components = buildSendComponents(
      row({
        buttons: [{ type: 'COPY_CODE', text: 'Copy', example: 'STATIC' }],
      }),
      { buttonParams: { 0: 'PERSONAL_CODE' } }
    );
    expect(
      (components[0] as { parameters: { coupon_code: string }[] }).parameters[0]
        .coupon_code
    ).toBe('PERSONAL_CODE');
  });

  it('skips PHONE_NUMBER buttons entirely (no send-time params allowed)', () => {
    const components = buildSendComponents(
      row({
        buttons: [
          { type: 'PHONE_NUMBER', text: 'Call', phone_number: '+15551234567' },
        ],
      })
    );
    expect(components).toEqual([]);
  });
});

describe('buildSendComponents — end-to-end mix', () => {
  it('orders components header → body → buttons and includes all', () => {
    const components = buildSendComponents(
      row({
        header_type: 'image',
        header_media_url: 'https://x.com/img.jpg',
        body_text: 'Hi {{1}}',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Yes' },
          { type: 'URL', text: 'Track', url: 'https://x.com/{{1}}' },
        ],
      }),
      { body: ['John'], buttonParams: { 1: 'abc' } }
    );
    expect(components.map((c) => c.type)).toEqual(['header', 'body', 'button']);
    // QUICK_REPLY at index 0 doesn't need send-time params, so only the
    // URL button at index 1 emits a component.
    expect((components[2] as { index: string }).index).toBe('1');
  });
});
