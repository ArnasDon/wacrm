import { describe, expect, it } from 'vitest';

import { webhookOrderingKey } from './producers';

const status = (recipient: string) => ({
  entry: [
    {
      id: 'waba',
      changes: [
        {
          value: {
            metadata: { phone_number_id: '111' },
            statuses: [{ recipient_id: recipient, status: 'delivered' }],
          },
        },
      ],
    },
  ],
});

describe('webhookOrderingKey', () => {
  it('keys statuses and messages by number + contact', () => {
    expect(webhookOrderingKey(status('9198'))).toBe('111:9198');
    expect(
      webhookOrderingKey({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: '111' },
                  messages: [{ from: '9198' }],
                },
              },
            ],
          },
        ],
      })
    ).toBe('111:9198');
  });

  it("a contact's status and reply share a key; other contacts don't", () => {
    expect(webhookOrderingKey(status('9198'))).not.toBe(
      webhookOrderingKey(status('9199'))
    );
  });

  it('falls back to the number, then the WABA, for other events', () => {
    expect(
      webhookOrderingKey({
        entry: [
          {
            id: 'waba',
            changes: [{ value: { metadata: { phone_number_id: '111' } } }],
          },
        ],
      })
    ).toBe('111');
    expect(
      webhookOrderingKey({
        entry: [
          {
            id: 'waba',
            changes: [{ field: 'message_template_status_update' }],
          },
        ],
      })
    ).toBe('waba');
    expect(webhookOrderingKey(null)).toBe('unknown');
  });
});
