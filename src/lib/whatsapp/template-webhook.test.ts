import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from './template-webhook';

// Tiny mock that records the .update payload and the .eq filter for
// inspection. Mirrors the surface this module actually uses on the
// Supabase client (.from().update().eq().select()) — anything beyond
// throws, so unintended calls fail loudly.
function makeSupabaseStub(
  selectResult: { data: { id: string }[] | null; error: { message: string } | null } = {
    data: [{ id: 'row-1' }],
    error: null,
  },
) {
  const calls: {
    table: string;
    update?: Record<string, unknown>;
    filter?: { column: string; value: unknown };
  }[] = [];

  const stub = {
    from(table: string) {
      const entry: (typeof calls)[number] = { table };
      calls.push(entry);
      return {
        update(payload: Record<string, unknown>) {
          entry.update = payload;
          return {
            eq(column: string, value: unknown) {
              entry.filter = { column, value };
              return {
                select() {
                  return Promise.resolve(selectResult);
                },
                then(
                  onFulfilled: (
                    v: { error: { message: string } | null },
                  ) => unknown,
                ) {
                  // Allow `await supabase.update().eq()` (no .select()).
                  return Promise.resolve({ error: selectResult.error }).then(
                    onFulfilled,
                  );
                },
              };
            },
          };
        },
      };
    },
  };

  return { stub: stub as unknown as SupabaseClient, calls };
}

describe('isTemplateWebhookField', () => {
  it('recognises the three template fields', () => {
    expect(isTemplateWebhookField('message_template_status_update')).toBe(true);
    expect(isTemplateWebhookField('message_template_quality_update')).toBe(true);
    expect(isTemplateWebhookField('message_template_components_update')).toBe(
      true,
    );
  });
  it('rejects messaging fields', () => {
    expect(isTemplateWebhookField('messages')).toBe(false);
    expect(isTemplateWebhookField('message_status')).toBe(false);
  });
});

describe('handleTemplateWebhookChange — status update', () => {
  let supabaseCalls: ReturnType<typeof makeSupabaseStub>['calls'];

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('flips status to APPROVED and clears any rejection_reason', async () => {
    const { stub, calls } = makeSupabaseStub();
    supabaseCalls = calls;
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: 'APPROVED',
          message_template_id: 12345,
          message_template_name: 'order_confirmation',
          message_template_language: 'en_US',
        },
      },
      stub,
    );
    expect(supabaseCalls).toHaveLength(1);
    expect(supabaseCalls[0].table).toBe('message_templates');
    expect(supabaseCalls[0].filter).toEqual({
      column: 'meta_template_id',
      value: '12345', // coerced to string so the .eq matches the TEXT column
    });
    expect(supabaseCalls[0].update).toEqual({
      status: 'APPROVED',
      rejection_reason: null,
      submission_error: null,
    });
  });

  it('persists the reason field on REJECTED', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: 'REJECTED',
          message_template_id: 'TMPL_99',
          reason: 'Template uses non-compliant language.',
        },
      },
      stub,
    );
    expect(calls[0].update?.status).toBe('REJECTED');
    expect(calls[0].update?.rejection_reason).toBe(
      'Template uses non-compliant language.',
    );
  });

  it('falls back to a generic reason when REJECTED has no `reason`', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: { event: 'REJECTED', message_template_id: '7' },
      },
      stub,
    );
    expect(calls[0].update?.rejection_reason).toBe('Rejected by Meta');
  });

  it('normalises PENDING_REVIEW → PENDING (via shared normalizeStatus)', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: { event: 'PENDING_REVIEW', message_template_id: '1' },
      },
      stub,
    );
    expect(calls[0].update?.status).toBe('PENDING');
  });

  it('logs and exits when meta_template_id is missing (no UPDATE issued)', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: { event: 'APPROVED' },
      },
      stub,
    );
    expect(calls).toHaveLength(0);
  });

  it('logs a warning when the row is unknown locally (zero matches)', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub } = makeSupabaseStub({ data: [], error: null });
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: 'APPROVED',
          message_template_id: 'NEVER_SEEN',
          message_template_name: 'mystery',
        },
      },
      stub,
    );
    expect(warn).toHaveBeenCalled();
  });
});

describe('handleTemplateWebhookChange — quality update', () => {
  it('sets quality_score from new_quality_score', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_quality_update',
        value: {
          message_template_id: '99',
          previous_quality_score: 'GREEN',
          new_quality_score: 'YELLOW',
        },
      },
      stub,
    );
    expect(calls[0].update).toEqual({ quality_score: 'YELLOW' });
    expect(calls[0].filter).toEqual({
      column: 'meta_template_id',
      value: '99',
    });
  });

  it('stores null for unrecognised quality scores', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_quality_update',
        value: {
          message_template_id: '99',
          new_quality_score: 'PURPLE', // not a real Meta value
        },
      },
      stub,
    );
    expect(calls[0].update).toEqual({ quality_score: null });
  });
});

describe('handleTemplateWebhookChange — components update', () => {
  it('is an info-log no-op (does not write to DB)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_components_update',
        value: {
          message_template_id: '5',
          message_template_name: 'x',
        },
      },
      stub,
    );
    expect(calls).toHaveLength(0);
    expect(info).toHaveBeenCalled();
  });
});

describe('handleTemplateWebhookChange — unknown field', () => {
  it('is a defensive no-op', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      // Pretend Meta added a new template_* field we don't know about.
      // The route handler pre-filters via isTemplateWebhookField, but
      // the dispatch should still be safe if the filter is bypassed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { field: 'message_template_future_field' as any, value: {} },
      stub,
    );
    expect(calls).toHaveLength(0);
  });
});
