import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// POST /api/products/[id]/vehicles — record a *verified* Product<->
// Vehicle compatibility match (admin+). Data entry only, per §11: "no
// automated matching engine" — an admin is asserting they've verified
// this pairing, which `verified_by`/`verified_at` record.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, userId, accountId } = await requireRole('admin');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const vehicleId =
      typeof body.vehicle_id === 'string' ? body.vehicle_id : '';
    if (!vehicleId) {
      return NextResponse.json(
        { error: 'vehicle_id is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('product_vehicles')
      .insert({
        account_id: accountId,
        product_id: id,
        vehicle_id: vehicleId,
        verified_by: userId,
        notes:
          typeof body.notes === 'string' ? body.notes.trim() || null : null,
      })
      .select(
        'id, notes, verified_at, verified_by, vehicle:vehicles(id, vehicle_type, manufacturer, model, engine)'
      )
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          {
            error:
              'This vehicle is already marked compatible with this product.',
          },
          { status: 409 }
        );
      }
      if (error.code === '23503') {
        return NextResponse.json(
          { error: 'Product or vehicle not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ compatibility: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
