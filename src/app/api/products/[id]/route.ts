import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const STATUSES = ['draft', 'pending_review', 'published', 'archived'] as const;

const DETAIL_SELECT = `
  *,
  category:product_categories(id, name),
  images:product_images(id, storage_path, alt_text, position),
  applications:product_applications(id, application, notes),
  claims:product_claims(id, claim_text, status, created_by, approved_by, approved_at, created_at),
  compatible_vehicles:product_vehicles(id, notes, verified_at, verified_by, vehicle:vehicles(id, vehicle_type, manufacturer, model, engine))
`;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('viewer');
    const { id } = await params;
    const { data, error } = await supabase
      .from('products')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json({ product: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

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

    if (typeof body.product_name === 'string') {
      const name = body.product_name.trim();
      if (!name)
        return NextResponse.json(
          { error: 'product_name cannot be empty' },
          { status: 400 }
        );
      update.product_name = name;
    }
    if (typeof body.product_code === 'string' || body.product_code === null) {
      update.product_code =
        typeof body.product_code === 'string'
          ? body.product_code.trim() || null
          : null;
    }
    if (typeof body.category_id === 'string' || body.category_id === null) {
      update.category_id = body.category_id;
    }
    for (const field of [
      'description',
      'short_description',
      'long_description',
      'packaging',
    ] as const) {
      if (typeof body[field] === 'string' || body[field] === null) {
        update[field] = body[field];
      }
    }
    for (const field of ['key_features', 'benefits'] as const) {
      if (Array.isArray(body[field])) {
        const cleaned = body[field].filter(
          (v: unknown): v is string =>
            typeof v === 'string' && v.trim().length > 0
        );
        update[field] = cleaned;
      }
    }
    for (const field of [
      'vehicle_types',
      'recommended_vehicles',
      'engine_types',
    ] as const) {
      if (Array.isArray(body[field])) {
        const cleaned = body[field].filter(
          (v: unknown): v is string =>
            typeof v === 'string' && v.trim().length > 0
        );
        update[field] = cleaned;
      }
    }
    if (typeof body.status === 'string') {
      if (!(STATUSES as readonly string[]).includes(body.status)) {
        return NextResponse.json(
          { error: `status must be one of: ${STATUSES.join(', ')}` },
          { status: 400 }
        );
      }
      update.status = body.status;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No editable fields provided' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('products')
      .update(update)
      .eq('id', id)
      .select(DETAIL_SELECT)
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A product with that code already exists.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data)
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json({ product: data });
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
    // Cascades to images/applications/claims/compatibility (all ON
    // DELETE CASCADE, migrations 041/042); content.product_id and
    // campaigns.product_id are ON DELETE SET NULL (046/043) so
    // deleting a product never silently deletes a post or campaign
    // that referenced it.
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
