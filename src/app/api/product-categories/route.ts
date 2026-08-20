import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// GET  /api/product-categories — list this account's categories (any member).
// POST /api/product-categories — create a category (admin+, per §11's
// "administrator-curated" product data posture — mirrors products
// itself, migration 041).

export async function GET() {
  try {
    const { supabase } = await requireRole('viewer');
    const { data, error } = await supabase
      .from('product_categories')
      .select('*')
      .order('name', { ascending: true });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ categories: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('product_categories')
      .insert({
        account_id: accountId,
        name,
        description:
          typeof body.description === 'string'
            ? body.description.trim() || null
            : null,
      })
      .select()
      .single();

    if (error) {
      // UNIQUE (account_id, name) — a friendlier message than the raw
      // Postgres constraint-violation text.
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A category named "${name}" already exists.` },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ category: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
