import { NextRequest, NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { INITIAL_DEMO_PRODUCTS, resetDemoProducts } from '@/lib/commerce/demo-store';

export const DEMO_PRODUCTS = INITIAL_DEMO_PRODUCTS;

/**
 * POST /api/products/seed
 * Seed the standard demo products into the active account
 */
export async function POST(_request: NextRequest) {
  try {
    const { supabase, accountId } = await requireRole('agent');

    const records = DEMO_PRODUCTS.map((item) => {
      // Omit static demo ID so Postgres gen_random_uuid() handles ID assignment
      const { id: _id, ...rest } = item;
      return {
        ...rest,
        account_id: accountId,
        updated_at: new Date().toISOString(),
      };
    });

    const { data, error } = await supabase
      .from('products')
      .upsert(records, { onConflict: 'account_id,sku' })
      .select();

    if (error) {
      if (error.message.includes('Could not find the table') || error.code === '42P01') {
        return NextResponse.json(
          { error: 'Products table does not exist in database. Run migration 032 first.' },
          { status: 503 }
        );
      }

      // If no unique constraint on (account_id, sku) yet, insert missing ones
      const { data: inserted, error: insertError } = await supabase
        .from('products')
        .insert(records)
        .select();

      if (insertError) {
        if (insertError.message.includes('Could not find the table') || insertError.code === '42P01') {
          return NextResponse.json(
            { error: 'Products table does not exist in database. Run migration 032 first.' },
            { status: 503 }
          );
        }
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
      return NextResponse.json({ count: inserted?.length || 0, products: inserted });
    }

    return NextResponse.json({ count: data?.length || 0, products: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
