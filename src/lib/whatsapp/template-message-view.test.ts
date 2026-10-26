import { describe, expect, it } from 'vitest';

import {
  matchMessageTemplate,
  templateMessageView,
  templateNamesInMessages,
} from './template-message-view';
import type { Message, MessageTemplate } from '@/types';

function template(over: Partial<MessageTemplate>): MessageTemplate {
  return {
    id: 'tpl-1',
    user_id: 'u-1',
    name: 'order_update',
    category: 'Utility',
    language: 'en_US',
    body_text: 'Your order {{1}} ships on {{2}}',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  } as MessageTemplate;
}

const IMAGE_TEMPLATE = template({
  header_type: 'image',
  header_media_url: 'https://cdn.example.com/banner.png',
  footer_text: 'Reply STOP to opt out',
  buttons: [
    { type: 'QUICK_REPLY', text: 'Track order' },
    { type: 'URL', text: 'Open shop', url: 'https://shop.example.com' },
    { type: 'PHONE_NUMBER', text: 'Call us', phone_number: '+15551234567' },
  ],
});

describe('templateMessageView', () => {
  it('returns the header image, footer and buttons the customer received', () => {
    const view = templateMessageView(
      { media_url: 'https://cdn.example.com/sent.png' },
      IMAGE_TEMPLATE
    );
    expect(view.header).toEqual({
      type: 'image',
      url: 'https://cdn.example.com/sent.png',
    });
    expect(view.footer).toBe('Reply STOP to opt out');
    expect(view.buttons.map((b) => b.text)).toEqual([
      'Track order',
      'Open shop',
      'Call us',
    ]);
  });

  it("falls back to the template's media for rows sent before the URL was stored", () => {
    const view = templateMessageView({}, IMAGE_TEMPLATE);
    expect(view.header).toEqual({
      type: 'image',
      url: 'https://cdn.example.com/banner.png',
    });
  });

  it('keeps a media header with no known URL so the bubble can say so', () => {
    const view = templateMessageView(
      {},
      template({ header_type: 'document', header_media_url: undefined })
    );
    expect(view.header).toEqual({ type: 'document', url: null });
  });

  it('returns a text header', () => {
    const view = templateMessageView(
      {},
      template({ header_type: 'text', header_content: 'Order update' })
    );
    expect(view.header).toEqual({ type: 'text', text: 'Order update' });
  });

  it('is empty when the template is unknown locally', () => {
    expect(
      templateMessageView({ media_url: 'https://x.example/a.png' }, null)
    ).toEqual({ header: null, footer: null, buttons: [] });
  });

  it('is empty for a body-only template', () => {
    expect(templateMessageView({}, template({}))).toEqual({
      header: null,
      footer: null,
      buttons: [],
    });
  });
});

describe('matchMessageTemplate', () => {
  const message = (over: Partial<Message>) =>
    ({
      template_name: 'order_update',
      content_text: 'Your order A1 ships on Friday',
      ...over,
    }) as Pick<Message, 'template_name' | 'content_text'>;

  it('matches by name', () => {
    expect(matchMessageTemplate(message({}), [IMAGE_TEMPLATE])).toBe(
      IMAGE_TEMPLATE
    );
  });

  it('returns null for another name or no name', () => {
    expect(
      matchMessageTemplate(message({ template_name: 'other' }), [IMAGE_TEMPLATE])
    ).toBeNull();
    expect(
      matchMessageTemplate(message({ template_name: undefined }), [
        IMAGE_TEMPLATE,
      ])
    ).toBeNull();
  });

  it('picks the translation whose body matches the stored text', () => {
    const english = template({ id: 'en', language: 'en_US' });
    const spanish = template({
      id: 'es',
      language: 'es',
      body_text: 'Tu pedido {{1}} sale el {{2}}',
    });
    expect(
      matchMessageTemplate(
        message({ content_text: 'Tu pedido A1 sale el viernes' }),
        [english, spanish]
      )?.id
    ).toBe('es');
    expect(matchMessageTemplate(message({}), [spanish, english])?.id).toBe(
      'en'
    );
  });

  it('treats regex characters in the body literally', () => {
    const priced = template({ id: 'priced', body_text: 'Total (USD): ${{1}}?' });
    const other = template({ id: 'other', body_text: 'Total USD {{1}}' });
    expect(
      matchMessageTemplate(message({ content_text: 'Total (USD): $9?' }), [
        other,
        priced,
      ])?.id
    ).toBe('priced');
  });

  it('falls back to the first row when no body matches', () => {
    const a = template({ id: 'a', body_text: 'A {{1}}' });
    const b = template({ id: 'b', body_text: 'B {{1}}' });
    expect(
      matchMessageTemplate(message({ content_text: 'something else' }), [a, b])
        ?.id
    ).toBe('a');
  });
});

describe('templateNamesInMessages', () => {
  it('lists each sent template name once, sorted', () => {
    expect(
      templateNamesInMessages([
        { content_type: 'template', template_name: 'welcome' },
        { content_type: 'text', template_name: undefined },
        { content_type: 'template', template_name: 'order_update' },
        { content_type: 'template', template_name: 'welcome' },
        { content_type: 'template', template_name: undefined },
      ])
    ).toEqual(['order_update', 'welcome']);
  });
});
