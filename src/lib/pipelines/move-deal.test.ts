import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { moveDeal, MoveDealError } from './move-deal';

interface Fixture {
  /** pipeline_stages row for the requested stageId, or null if none matches (cross-tenant/missing). */
  stage?: { id: string; pipeline_id: string; is_won: boolean } | null;
  /** deals row returned after the update, or null (deal not in that pipeline/account). */
  updatedDeal?: { id: string; pipeline_id: string; stage_id: string; status: string } | null;
}

function makeDb(fx: Fixture, updatePayloads: Record<string, unknown>[] = []): SupabaseClient {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        update: (payload: Record<string, unknown>) => {
          updatePayloads.push(payload);
          return b;
        },
        maybeSingle: async () => {
          if (table === 'pipeline_stages') {
            return { data: fx.stage ?? null, error: null };
          }
          if (table === 'deals') {
            return { data: fx.updatedDeal ?? null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe('moveDeal', () => {
  it('moves a deal to a non-won stage without touching status', async () => {
    const db = makeDb({
      stage: { id: 'stage-2', pipeline_id: 'pipe-1', is_won: false },
      updatedDeal: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-2', status: 'active' },
    });

    const result = await moveDeal(db, 'acct-1', 'deal-1', 'stage-2');

    expect(result.isWonStage).toBe(false);
    expect(result.deal).toEqual({
      id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-2', status: 'active',
    });
  });

  it('sets status to won and reports isWonStage when the target stage is is_won', async () => {
    const db = makeDb({
      stage: { id: 'stage-4', pipeline_id: 'pipe-1', is_won: true },
      updatedDeal: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-4', status: 'won' },
    });

    const result = await moveDeal(db, 'acct-1', 'deal-1', 'stage-4');

    expect(result.isWonStage).toBe(true);
    expect(result.deal.status).toBe('won');
  });

  it('stamps won_at when the target stage is is_won, for accurate "won in this date range" KPI reporting', async () => {
    const updatePayloads: Record<string, unknown>[] = [];
    const db = makeDb(
      {
        stage: { id: 'stage-4', pipeline_id: 'pipe-1', is_won: true },
        updatedDeal: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-4', status: 'won' },
      },
      updatePayloads,
    );

    await moveDeal(db, 'acct-1', 'deal-1', 'stage-4');

    const dealsUpdate = updatePayloads.find((p) => 'status' in p);
    expect(dealsUpdate).toMatchObject({ status: 'won' });
    expect(typeof dealsUpdate?.won_at).toBe('string');
    expect(Number.isNaN(new Date(dealsUpdate?.won_at as string).getTime())).toBe(false);
  });

  it('does not stamp won_at when the target stage is not is_won', async () => {
    const updatePayloads: Record<string, unknown>[] = [];
    const db = makeDb(
      {
        stage: { id: 'stage-2', pipeline_id: 'pipe-1', is_won: false },
        updatedDeal: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-2', status: 'active' },
      },
      updatePayloads,
    );

    await moveDeal(db, 'acct-1', 'deal-1', 'stage-2');

    expect(updatePayloads[0]).toEqual({ stage_id: 'stage-2' });
  });

  it('throws 404 when the stage does not belong to the caller account (cross-tenant)', async () => {
    const db = makeDb({ stage: null });

    await expect(moveDeal(db, 'acct-1', 'deal-1', 'stage-from-other-account')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      moveDeal(db, 'acct-1', 'deal-1', 'stage-from-other-account')
    ).rejects.toBeInstanceOf(MoveDealError);
  });

  it('throws 404 when the deal is not found in that pipeline/account', async () => {
    const db = makeDb({
      stage: { id: 'stage-2', pipeline_id: 'pipe-1', is_won: false },
      updatedDeal: null,
    });

    await expect(moveDeal(db, 'acct-1', 'deal-from-other-account', 'stage-2')).rejects.toMatchObject({
      status: 404,
      message: 'Deal not found in this pipeline',
    });
  });
});
