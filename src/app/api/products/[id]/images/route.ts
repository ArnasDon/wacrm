import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

// POST /api/products/[id]/images — attach an already-uploaded image
// (client uploads to the `chat-media` bucket first via
// uploadAccountMedia, then posts the resulting storage_path here — same
// two-step pattern Content Studio's voice notes use). admin+, matching
// every other product-data write (§11).

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const storagePath =
      typeof body.storage_path === 'string' ? body.storage_path.trim() : '';
    if (!storagePath) {
      return NextResponse.json(
        { error: 'storage_path is required' },
        { status: 400 }
      );
    }

    const { count } = await supabase
      .from('product_images')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', id);

    const { data, error } = await supabase
      .from('product_images')
      .insert({
        account_id: accountId,
        product_id: id,
        storage_path: storagePath,
        alt_text:
          typeof body.alt_text === 'string'
            ? body.alt_text.trim() || null
            : null,
        position: count ?? 0,
      })
      .select()
      .single();

    if (error) {
      // FK violation (23503) means `id` isn't a real product row.
      if (error.code === '23503') {
        return NextResponse.json(
          { error: 'Product not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ image: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
