import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// GET  /api/vehicles — list this account's Vehicle Type/Manufacturer/
// Model/Engine entries (any member).
// POST /api/vehicles — add one (admin+ — verified-compatibility data
// is administrator-curated per §11, same tier as products themselves).

export async function GET(request: Request) {
  try {
    const { supabase } = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const vehicleType = searchParams.get('vehicle_type');

    let query = supabase
      .from('vehicles')
      .select('*')
      .order('manufacturer', { ascending: true })
      .order('model', { ascending: true });
    if (vehicleType) query = query.eq('vehicle_type', vehicleType);

    const { data, error } = await query;
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ vehicles: data ?? [] });
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

    const vehicleType =
      typeof body.vehicle_type === 'string' ? body.vehicle_type.trim() : '';
    const manufacturer =
      typeof body.manufacturer === 'string' ? body.manufacturer.trim() : '';
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    const engine = typeof body.engine === 'string' ? body.engine.trim() : '';

    if (!vehicleType || !manufacturer || !model) {
      return NextResponse.json(
        { error: 'vehicle_type, manufacturer, and model are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('vehicles')
      .insert({
        account_id: accountId,
        vehicle_type: vehicleType,
        manufacturer,
        model,
        engine,
      })
      .select()
      .single();

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
    return NextResponse.json({ vehicle: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
