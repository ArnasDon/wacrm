import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recalculateMatchesForProperty, createPropertyShare } from './service';

interface DeleteCall {
  col: string;
  val: unknown;
}

describe('Disponibilidade e Sincronização de Imóveis no WACRM', () => {
  const accountId = 'acc-test-123';
  const propertyId = '11111111-2222-3333-4444-555555555555';
  const leadId = 'lead-test-999';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. recalculateMatchesForProperty expurga matches "novo" se imóvel estiver inativo ou arquivado', async () => {
    const deleteCalls: DeleteCall[] = [];
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'property_match_projections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                property_id: propertyId,
                status: 'inativo',
              },
              error: null,
            }),
          };
        }
        if (table === 'lead_property_matches') {
          const deleteBuilder: Record<string, unknown> = {};
          deleteBuilder.eq = vi.fn((col: string, val: unknown) => {
            deleteCalls.push({ col, val });
            return deleteBuilder;
          });
          return {
            delete: vi.fn(() => deleteBuilder),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const res = await recalculateMatchesForProperty(mockDb, accountId, propertyId);
    expect(res.totalLeadsEvaluated).toBe(0);
    expect(res.strongMatchesCount).toBe(0);

    // Confirma que acionou deleção com match_status = 'novo'
    expect(deleteCalls).toEqual(
      expect.arrayContaining([
        { col: 'account_id', val: accountId },
        { col: 'property_id', val: propertyId },
        { col: 'match_status', val: 'novo' },
      ])
    );
  });

  it('2. recalculateMatchesForProperty expurga matches "novo" se imóvel não existir na projeção', async () => {
    const deleteCalls: DeleteCall[] = [];
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'property_match_projections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          };
        }
        if (table === 'lead_property_matches') {
          const deleteBuilder: Record<string, unknown> = {};
          deleteBuilder.eq = vi.fn((col: string, val: unknown) => {
            deleteCalls.push({ col, val });
            return deleteBuilder;
          });
          return {
            delete: vi.fn(() => deleteBuilder),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const res = await recalculateMatchesForProperty(mockDb, accountId, propertyId);
    expect(res.totalLeadsEvaluated).toBe(0);
    expect(deleteCalls).toEqual(
      expect.arrayContaining([
        { col: 'account_id', val: accountId },
        { col: 'property_id', val: propertyId },
        { col: 'match_status', val: 'novo' },
      ])
    );
  });

  it('3. createPropertyShare recusa e retorna null se imóvel for inativo ou arquivado', async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'property_match_projections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                property_id: propertyId,
                status: 'arquivado',
              },
              error: null,
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const result = await createPropertyShare(mockDb, {
      accountId,
      leadId,
      propertyId,
    });

    expect(result).toBeNull();
  });

  it('4. createPropertyShare recusa e retorna null se imóvel não existir', async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'property_match_projections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const result = await createPropertyShare(mockDb, {
      accountId,
      leadId,
      propertyId,
    });

    expect(result).toBeNull();
  });

  it('5. createPropertyShare gera token e registro com sucesso se imóvel estiver ativo', async () => {
    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'property_match_projections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                property_id: propertyId,
                status: 'ativo',
              },
              error: null,
            }),
          };
        }
        if (table === 'property_shares') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'share-123',
                account_id: accountId,
                lead_id: leadId,
                property_id: propertyId,
                tracking_token: 'valid-test-token',
                sent_at: new Date().toISOString(),
              },
              error: null,
            }),
          };
        }
        if (table === 'lead_property_matches') {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
          };
        }
        if (table === 'contacts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { phone: '5583999998888' },
            }),
          };
        }
        return {};
      }),
    } as unknown as SupabaseClient;

    const result = await createPropertyShare(mockDb, {
      accountId,
      leadId,
      propertyId,
      matchId: 'match-123',
    });

    expect(result).not.toBeNull();
    expect(result?.share.id).toBe('share-123');
    expect(result?.publicUrl).toContain('imoveis/p');
  });
});
