import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adjustInventory } from './service';

describe('Phase 3: Inventory and Order Safety', () => {
  it('throws an error when stock is insufficient and RPC reports error', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Insufficient stock: item has 0 units on hand, requested deduction 1' },
        }),
      }),
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(
      adjustInventory(mockSupabase, {
        accountId: '00000000-0000-0000-0000-000000000001',
        productId: '00000000-0000-0000-0000-000000000002',
        quantityOnHandDelta: -1,
      })
    ).rejects.toThrow(/insufficient stock/i);
  });

  it('successfully returns updated item when stock is sufficient', async () => {
    const mockItem = {
      id: 'inv-1',
      account_id: 'acc-1',
      product_id: 'prod-1',
      location_name: 'Main Warehouse',
      quantity_on_hand: 5,
      quantity_reserved: 0,
      reorder_threshold: 2,
    };

    const mockSupabase = {
      rpc: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: mockItem,
          error: null,
        }),
      }),
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'audit-1' }, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await adjustInventory(mockSupabase, {
      accountId: 'acc-1',
      productId: 'prod-1',
      quantityOnHandDelta: -1,
    });

    expect(result.quantity_on_hand).toBe(5);
  });
});
