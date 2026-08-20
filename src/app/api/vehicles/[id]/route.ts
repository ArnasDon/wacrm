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
    for (const field of [
      'vehicle_type',
      'manufacturer',
      'model',
      'engine',
    ] as const) {
      if (typeof body[field] === 'string') {
        const value = body[field].trim();
        if (field !== 'engine' && !value) {
          return NextResponse.json(
            { error: `${field} cannot be empty` },
            { status: 400 }
          );
        }
        update[field] = value;
      }
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No editable fields provided' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('vehicles')
      .update(update)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          {
            error:
              'This exact vehicle (type/manufacturer/model/engine) already exists.',
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data)
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    return NextResponse.json({ vehicle: data });
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
    // product_vehicles.vehicle_id is ON DELETE CASCADE (migration 042) —
    // deleting a vehicle also removes any compatibility rows pointing at
    // it. That's the intended behaviour (a deleted vehicle can't stay
    // "verified compatible" with anything), not a silent side effect to
    // guard against.
    const { error } = await supabase.from('vehicles').delete().eq('id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
