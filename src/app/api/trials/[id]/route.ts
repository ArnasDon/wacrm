import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { commitAssignment } from '@/lib/routing/service';
import { writeEngagementEvent } from '@/lib/whatsapp/engagement';
import { writeProductInteraction } from '@/lib/analytics/product-interaction';

const STATUSES = [
  'NEW',
  'REQUESTED',
  'ASSIGNED',
  'SCHEDULED',
  'COMPLETED',
  'CONVERTED',
  'CANCELLED',
] as const;
const TERMINAL_STATUSES = new Set(['CONVERTED', 'CANCELLED']);
const TERMINAL_STATUSES_DEAL = new Set(['CONVERTED', 'LOST']);

const SELECT =
  '*, contact:contacts(id, name, phone), product:products(id, product_name)';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('viewer');
    const { id } = await params;
    const { data, error } = await supabase
      .from('trials')
      .select(SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json({ error: 'Trial not found' }, { status: 404 });
    return NextResponse.json({ trial: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

    const { data: existing, error: fetchErr } = await supabase
      .from('trials')
      .select('status, assigned_ba_id, contact_id, product_id, deal_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!existing)
      return NextResponse.json({ error: 'Trial not found' }, { status: 404 });

    const update: Record<string, unknown> = {};

    for (const field of [
      'name',
      'role',
      'market',
      'vehicle',
      'notes',
    ] as const) {
      if (typeof body[field] === 'string' || body[field] === null)
        update[field] = body[field];
    }
    if (typeof body.phone === 'string') {
      const phone = body.phone.trim();
      if (!phone)
        return NextResponse.json(
          { error: 'phone cannot be empty' },
          { status: 400 }
        );
      update.phone = phone;
    }

    let newStatus: string | undefined;
    if (typeof body.status === 'string') {
      if (!(STATUSES as readonly string[]).includes(body.status)) {
        return NextResponse.json(
          { error: `status must be one of: ${STATUSES.join(', ')}` },
          { status: 400 }
        );
      }
      newStatus = body.status;
      update.status = newStatus;
    }

    let reassigned = false;
    let nextBaId: string | null = existing.assigned_ba_id;
    if (body.assigned_ba_id !== undefined) {
      if (
        body.assigned_ba_id !== null &&
        typeof body.assigned_ba_id !== 'string'
      ) {
        return NextResponse.json(
          { error: 'assigned_ba_id must be a string or null' },
          { status: 400 }
        );
      }
      nextBaId = body.assigned_ba_id;
      update.assigned_ba_id = nextBaId;
      update.routing_reason = nextBaId
        ? 'Manually assigned'
        : 'Manually unassigned';
      reassigned = existing.assigned_ba_id !== nextBaId;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No editable fields provided' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('trials')
      .update(update)
      .eq('id', id)
      .select(SELECT)
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json({ error: 'Trial not found' }, { status: 404 });

    if (reassigned) {
      await commitAssignment(supabase, {
        previousBaId: existing.assigned_ba_id,
        nextBaId,
      });
    }

    if (newStatus && newStatus !== existing.status) {
      const wasTerminal = TERMINAL_STATUSES.has(existing.status);
      const isTerminal = TERMINAL_STATUSES.has(newStatus);
      const assigneeAfter = reassigned ? nextBaId : existing.assigned_ba_id;
      if (wasTerminal !== isTerminal && assigneeAfter) {
        await commitAssignment(supabase, {
          previousBaId: isTerminal ? assigneeAfter : null,
          nextBaId: isTerminal ? null : assigneeAfter,
        });
      }

      if (newStatus === 'CONVERTED') {
        const admin = supabaseAdmin();
        await writeEngagementEvent(admin, {
          accountId,
          memberId: existing.contact_id,
          postId: null,
          eventType: 'CONVERSION',
          source: 'manual',
        });
        await writeProductInteraction(admin, {
          accountId,
          contactId: existing.contact_id,
          productId: existing.product_id,
          interactionType: 'conversion',
        });

        // A Trial converting closes out its linked Lead too, if any
        // (§9.1: `deal_id` is the forward-link a Trial converts into).
        // Bypasses `PATCH /api/leads/[id]`'s own CONVERTED handling
        // (which would fire a second, duplicate CONVERSION event for
        // the same funnel step) but still has to replicate its
        // open_leads bookkeeping directly.
        if (existing.deal_id) {
          const { data: linkedDeal } = await supabase
            .from('deals')
            .select('status, assigned_to')
            .eq('id', existing.deal_id)
            .maybeSingle();
          await supabase
            .from('deals')
            .update({ status: 'CONVERTED' })
            .eq('id', existing.deal_id);
          if (
            linkedDeal &&
            !TERMINAL_STATUSES_DEAL.has(linkedDeal.status) &&
            linkedDeal.assigned_to
          ) {
            const { data: p } = await supabase
              .from('profiles')
              .select('user_id')
              .eq('id', linkedDeal.assigned_to)
              .maybeSingle();
            if (p?.user_id) {
              await commitAssignment(supabase, {
                previousBaId: p.user_id,
                nextBaId: null,
              });
            }
          }
        }
      }
    }

    return NextResponse.json({ trial: data });
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

    const { data: existing } = await supabase
      .from('trials')
      .select('assigned_ba_id, status')
      .eq('id', id)
      .maybeSingle();

    const { error } = await supabase.from('trials').delete().eq('id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    if (existing?.assigned_ba_id && !TERMINAL_STATUSES.has(existing.status)) {
      await commitAssignment(supabase, {
        previousBaId: existing.assigned_ba_id,
        nextBaId: null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
