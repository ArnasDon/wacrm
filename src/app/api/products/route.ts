import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// GET  /api/products — list this account's product catalog (any member).
// POST /api/products — create a Draft product (admin+ — product data is
// administrator-curated per §11, migration 041's RLS tier).

export async function GET(request: Request) {
  try {
    const { supabase } = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const categoryId = searchParams.get('category_id');

    let query = supabase
      .from('products')
      .select('*, category:product_categories(id, name)')
      .order('updated_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (categoryId) query = query.eq('category_id', categoryId);

    const { data, error } = await query;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ products: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId, accountId } = await requireRole('admin');

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const productName =
      typeof body.product_name === 'string' ? body.product_name.trim() : '';
    if (!productName) {
      return NextResponse.json(
        { error: 'product_name is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('products')
      .insert({
        account_id: accountId,
        product_name: productName,
        product_code:
          typeof body.product_code === 'string'
            ? body.product_code.trim() || null
            : null,
        category_id:
          typeof body.category_id === 'string' ? body.category_id : null,
        description:
          typeof body.description === 'string' ? body.description : null,
        short_description:
          typeof body.short_description === 'string'
            ? body.short_description
            : null,
        long_description:
          typeof body.long_description === 'string'
            ? body.long_description
            : null,
        packaging: typeof body.packaging === 'string' ? body.packaging : null,
        status: 'draft',
        created_by: userId,
      })
      .select('*, category:product_categories(id, name)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          {
            error: `A product with code "${body.product_code}" already exists.`,
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ product: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
