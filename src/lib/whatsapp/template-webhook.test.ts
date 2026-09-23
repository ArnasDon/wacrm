import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from './template-webhook';

// Tiny mock that records the .update payload and the .eq filter for
// inspection. Mirrors the surface this module actually uses on the
// Supabase client — anything beyond throws, so unintended calls fail
// loudly:
//   message_templates: .update().eq().select()  → selectResult (then
//                      retrySelectResult for the 2nd call, if given)
//                      .insert()               → { error: insertError }
//   whatsapp_config:   .select().eq()           → { data: configRows }
type SelectResult = {
  data: { id: string }[] | null;
  error: { message: string; code?: string } | null;
};

function makeSupabaseStub(
  selectResult: SelectResult = { data: [{ id: 'row-1' }], error: null },
  opts: {
    configRows?: { account_id: string; user_id: string }[];
    insertError?: { message: string; code?: string } | null;
    retrySelectResult?: SelectResult;
  } = {},
) {
  const calls: {
    table: string;
    update?: Record<string, unknown>;
    filter?: { column: string; value: unknown };
    insert?: Record<string, unknown>;
    select?: string;
  }[] = [];
  let updateCount = 0;

  const stub = {
    from(table: string) {
      const entry: (typeof calls)[number] = { table };
      calls.push(entry);
      if (table === 'whatsapp_config') {
        return {
          select(columns: string) {
            entry.select = columns;
            return {
              eq(column: string, value: unknown) {
                entry.filter = { column, value };
                return Promise.resolve({
                  data: opts.configRows ?? [],
                  error: null,
                });
              },
            };
          },
        };
      }
      return {
        insert(row: Record<string, unknown>) {
          entry.insert = row;
          return Promise.resolve({ error: opts.insertError ?? null });
        },
        update(payload: Record<string, unknown>) {
          entry.update = payload;
          updateCount++;
          const result =
            updateCount > 1 && opts.retrySelectResult
              ? opts.retrySelectResult
              : selectResult;
          return {
            eq(column: string, value: unknown) {
              entry.filter = { column, value };
              return {
                select() {
                  return Promise.resolve(result);
                },
                then(
                  onFulfilled: (
                    v: { error: { message: string } | null },
                  ) => unknown,
                ) {
                  // Allow `await supabase.update().eq()` (no .select()).
                  return Promise.resolve({ error: result.error }).then(
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

  it('logs a warning when the row is unknown locally and no WABA id was passed', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub({ data: [], error: null });
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
    expect(String(warn.mock.calls[0][0])).toContain('no WABA id');
    // Without a WABA id there is nothing to resolve the account with —
    // no config lookup, no insert.
    expect(calls).toHaveLength(1);
    expect(calls[0].insert).toBeUndefined();
  });
});

describe('handleTemplateWebhookChange — unknown template stub (#534)', () => {
  const CONFIG = { account_id: 'acc-1', user_id: 'admin-1' };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('inserts a stub row for a 0-row status update when exactly one config matches the WABA', async () => {
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      { configRows: [CONFIG] },
    );
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: 'APPROVED',
          message_template_id: 555,
          message_template_name: 'created_in_meta',
          message_template_language: 'de',
        },
        wabaId: 'WABA-1',
      },
      stub,
    );

    expect(calls.map((c) => c.table)).toEqual([
      'message_templates', // the original UPDATE (0 rows)
      'whatsapp_config', // resolve the tenant
      'message_templates', // the stub INSERT
    ]);
    expect(calls[1].select).toBe('account_id, user_id');
    expect(calls[1].filter).toEqual({ column: 'waba_id', value: 'WABA-1' });
    expect(calls[2].insert).toEqual({
      account_id: 'acc-1',
      user_id: 'admin-1',
      meta_template_id: '555',
      name: 'created_in_meta',
      language: 'de',
      body_text: '',
      status: 'APPROVED',
      rejection_reason: null,
      submission_error: null,
    });
  });

  it('carries the rejection reason into the stub on REJECTED and defaults language to en_US', async () => {
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      { configRows: [CONFIG] },
    );
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: 'REJECTED',
          message_template_id: '556',
          message_template_name: 'spammy',
          reason: 'INVALID_FORMAT',
        },
        wabaId: 'WABA-1',
      },
      stub,
    );
    expect(calls[2].insert).toMatchObject({
      status: 'REJECTED',
      rejection_reason: 'INVALID_FORMAT',
      language: 'en_US',
    });
  });

  it('warns with the WABA id and inserts nothing when no config matches', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      { configRows: [] },
    );
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: 'APPROVED',
          message_template_id: '557',
          message_template_name: 'orphan',
        },
        wabaId: 'WABA-NOBODY',
      },
      stub,
    );
    expect(calls).toHaveLength(2); // update + config lookup, no insert
    expect(calls.some((c) => c.insert)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('WABA WABA-NOBODY');
    expect(message).toContain('557');
    expect(message).toContain('no whatsapp_config rows');
  });

  it('refuses to guess the tenant when several configs share the WABA id', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      {
        configRows: [CONFIG, { account_id: 'acc-2', user_id: 'admin-2' }],
      },
    );
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: 'APPROVED',
          message_template_id: '558',
          message_template_name: 'shared',
        },
        wabaId: 'WABA-1',
      },
      stub,
    );
    expect(calls.some((c) => c.insert)).toBe(false);
    expect(String(warn.mock.calls[0][0])).toContain('2 whatsapp_config rows');
  });

  it('inserts a stub with quality_score (and no status) for a 0-row quality update', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      { configRows: [CONFIG] },
    );
    await handleTemplateWebhookChange(
      {
        field: 'message_template_quality_update',
        value: {
          message_template_id: '559',
          message_template_name: 'created_in_meta',
          message_template_language: 'en_US',
          previous_quality_score: 'UNKNOWN',
          new_quality_score: 'RED',
        },
        wabaId: 'WABA-1',
      },
      stub,
    );
    expect(calls[0].update).toEqual({ quality_score: 'RED' });
    expect(calls[2].insert).toEqual({
      account_id: 'acc-1',
      user_id: 'admin-1',
      meta_template_id: '559',
      name: 'created_in_meta',
      language: 'en_US',
      body_text: '',
      quality_score: 'RED',
    });
    // `status` is deliberately absent — the column default applies.
    expect(calls[2].insert).not.toHaveProperty('status');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns (with the WABA id) on a 0-row quality update when the tenant cannot be resolved', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      { configRows: [] },
    );
    await handleTemplateWebhookChange(
      {
        field: 'message_template_quality_update',
        value: {
          message_template_id: '560',
          message_template_name: 'orphan',
          new_quality_score: 'GREEN',
        },
        wabaId: 'WABA-NOBODY',
      },
      stub,
    );
    expect(calls.some((c) => c.insert)).toBe(false);
    expect(String(warn.mock.calls[0][0])).toContain('quality update');
    expect(String(warn.mock.calls[0][0])).toContain('WABA WABA-NOBODY');
  });

  it('retries the update once when the stub insert hits a unique violation', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      {
        configRows: [CONFIG],
        insertError: { message: 'duplicate key', code: '23505' },
        retrySelectResult: { data: [{ id: 'row-raced' }], error: null },
      },
    );
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: 'PAUSED',
          message_template_id: '561',
          message_template_name: 'raced',
        },
        wabaId: 'WABA-1',
      },
      stub,
    );
    const updates = calls.filter((c) => c.update);
    expect(updates).toHaveLength(2);
    expect(updates[1].update).toEqual(updates[0].update);
    expect(updates[1].filter).toEqual({
      column: 'meta_template_id',
      value: '561',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not create a stub when the event has no template name', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      { configRows: [CONFIG] },
    );
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: { event: 'APPROVED', message_template_id: '562' },
        wabaId: 'WABA-1',
      },
      stub,
    );
    expect(calls).toHaveLength(1);
    expect(String(warn.mock.calls[0][0])).toContain('no message_template_name');
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
