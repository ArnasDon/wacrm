import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  resolveProductCatalogueService,
  CatalogueNotConfiguredError,
} from '@/lib/products/catalogue-service';

// GET  /api/products/[id]/catalogue-sync — current whatsapp_sync_log
//      row for this product (admin-tier read, matches products RLS).
// POST /api/products/[id]/catalogue-sync — attempt a sync. Always
//      records the attempt in whatsapp_sync_log — a not-configured
//      failure is still a real, visible status change (Sync Error),
//      never a silent no-op (§16).

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('admin');
    const { id } = await params;
    const { data, error } = await supabase
      .from('whatsapp_sync_log')
      .select('*')
      .eq('product_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ sync_log: data ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;

    const { data: product, error: productErr } = await supabase
      .from('products')
      .select('id, product_code, product_name, description, short_description')
      .eq('id', id)
      .maybeSingle();
    if (productErr)
      return NextResponse.json({ error: productErr.message }, { status: 500 });
    if (!product)
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const { data: image } = await supabase
      .from('product_images')
      .select('storage_path')
      .eq('product_id', id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    const imageUrl = image?.storage_path
      ? supabase.storage.from('chat-media').getPublicUrl(image.storage_path)
          .data.publicUrl
      : null;

    const service = resolveProductCatalogueService();
    const now = new Date().toISOString();

    try {
      const result = await service.syncProduct({
        productId: product.id,
        retailerId: product.product_code || product.id,
        name: product.product_name,
        description: product.short_description || product.description,
        imageUrl,
      });

      // whatsapp_sync_log has no UNIQUE(product_id) (migration 048) —
      // it's a log of sync attempts, not a single current-status row,
      // so every attempt is a new INSERT; "current status" is just
      // the latest row (see GET above).
      const { data: log, error: insertErr } = await supabase
        .from('whatsapp_sync_log')
        .insert({
          account_id: accountId,
          product_id: id,
          whatsapp_catalogue_id: result.whatsappCatalogueId,
          sync_status: 'Synced',
          last_synced_at: now,
          sync_error: null,
        })
        .select('*')
        .single();
      if (insertErr)
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      return NextResponse.json({ sync_log: log });
    } catch (err) {
      const message =
        err instanceof CatalogueNotConfiguredError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unknown catalogue sync error';

      const { data: log, error: insertErr } = await supabase
        .from('whatsapp_sync_log')
        .insert({
          account_id: accountId,
          product_id: id,
          sync_status: 'Sync Error',
          sync_error: message,
        })
        .select('*')
        .single();
      if (insertErr)
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      // 200, not 500 — the sync attempt was handled correctly and its
      // (failure) outcome is right there in the response body. A 500
      // here would read as "this API route is broken," which it isn't.
      return NextResponse.json({ sync_log: log, warning: message });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
