import { describe, it, expect } from 'vitest';

import { serializeTemplate } from './templates';

describe('serializeTemplate', () => {
  it('projects a full row and drops internal fields', () => {
    const row = {
      id: 't1',
      user_id: 'internal-user',
      account_id: 'internal-acct',
      name: 'order_update',
      category: 'Utility',
      language: 'en_US',
      header_type: 'text',
      header_content: 'Order {{1}}',
      header_handle: 'internal-handle',
      header_media_url: null,
      body_text: 'Your order {{1}} shipped.',
      footer_text: null,
      buttons: [{ type: 'QUICK_REPLY', text: 'Track' }],
      sample_values: { body: ['A123'] },
      status: 'APPROVED',
      meta_template_id: 'meta-123',
      quality_score: 'GREEN',
      rejection_reason: null,
      submission_error: null,
      last_submitted_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    const out = serializeTemplate(row);
    expect(out).not.toHaveProperty('user_id');
    expect(out).not.toHaveProperty('account_id');
    expect(out).not.toHaveProperty('header_handle');
    expect(out).not.toHaveProperty('meta_template_id');
    expect(out.name).toBe('order_update');
    expect(out.buttons).toEqual([{ type: 'QUICK_REPLY', text: 'Track' }]);
    expect(out.sample_values).toEqual({ body: ['A123'] });
  });

  it('nulls every optional field that was never set', () => {
    const row = {
      id: 't2',
      name: 'draft_only',
      category: 'Marketing',
      body_text: 'Hello!',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const out = serializeTemplate(row);
    expect(out.language).toBeNull();
    expect(out.header_type).toBeNull();
    expect(out.buttons).toBeNull();
    expect(out.sample_values).toBeNull();
    expect(out.status).toBeNull();
    expect(out.quality_score).toBeNull();
    expect(out.rejection_reason).toBeNull();
  });
});
