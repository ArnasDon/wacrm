import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

const STATUSES = [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('viewer');
    const { id } = await params;
    const { data, error } = await supabase
      .from('campaigns')
      .select(
        // Aliased `linked_content`, not `content` — campaigns.content
        // (free-text notes) is a real column `*` already selects, and
        // reusing the same key for the embedded content-post list would
        // collide with it.
        '*, product:products(id, product_name), linked_content:content(id, title, status)'
      )
      .eq('id', id)
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    return NextResponse.json({ campaign: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('agent');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const update: Record<string, unknown> = {};

    if (typeof body.campaign_name === 'string') {
      const name = body.campaign_name.trim();
      if (!name)
        return NextResponse.json(
          { error: 'campaign_name cannot be empty' },
          { status: 400 }
        );
      update.campaign_name = name;
    }
    if (typeof body.product_id === 'string' || body.product_id === null) {
      update.product_id = body.product_id;
    }
    for (const field of ['start_date', 'end_date'] as const) {
      if (body[field] !== undefined) {
        if (
          body[field] !== null &&
          (typeof body[field] !== 'string' || !DATE_RE.test(body[field]))
        ) {
          return NextResponse.json(
            { error: `${field} must be a YYYY-MM-DD date string` },
            { status: 400 }
          );
        }
        update[field] = body[field];
      }
    }
    for (const field of ['objective', 'content'] as const) {
      if (typeof body[field] === 'string' || body[field] === null) {
        update[field] = body[field];
      }
    }
    if (body.audience && typeof body.audience === 'object') {
      update.audience = body.audience;
    }
    if (body.cost !== undefined) {
      if (body.cost === null) {
        update.cost = null;
      } else {
        const parsed = Number(body.cost);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return NextResponse.json(
            { error: 'cost must be a non-negative number' },
            { status: 400 }
          );
        }
        update.cost = parsed;
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
      .from('campaigns')
      .update(update)
      .eq('id', id)
      .select('*, product:products(id, product_name)')
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    return NextResponse.json({ campaign: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('agent');
    const { id } = await params;
    // content.campaign_id is ON DELETE SET NULL (migration 046) — a
    // campaign with content attributed to it can still be deleted; the
    // content just loses its campaign attribution rather than being
    // deleted itself.
    const { error } = await supabase.from('campaigns').delete().eq('id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
