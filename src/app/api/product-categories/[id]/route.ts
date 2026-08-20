import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('admin');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const update: Record<string, unknown> = {};
    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name)
        return NextResponse.json(
          { error: 'name cannot be empty' },
          { status: 400 }
        );
      update.name = name;
    }
    if (typeof body.description === 'string' || body.description === null) {
      update.description = body.description || null;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No editable fields provided' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('product_categories')
      .update(update)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A category with that name already exists.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data)
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    return NextResponse.json({ category: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('admin');
    const { id } = await params;
    // No RESTRICT on products.category_id (ON DELETE SET NULL, migration
    // 041) — deleting a category un-categorizes its products rather than
    // failing or cascading, matching the FK's own design.
    const { error } = await supabase
      .from('product_categories')
      .delete()
      .eq('id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
