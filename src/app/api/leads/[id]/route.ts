import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { commitAssignment } from '@/lib/routing/service';
import { writeEngagementEvent } from '@/lib/whatsapp/engagement';
import { writeProductInteraction } from '@/lib/analytics/product-interaction';

const STATUSES = [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'INTERESTED',
  'TRIAL_REQUESTED',
  'TRIAL_COMPLETED',
  'CONVERTED',
  'LOST',
] as const;
const TERMINAL_STATUSES = new Set(['CONVERTED', 'LOST']);

const SELECT =
  '*, contact:contacts(id, name, phone), assignee:profiles!deals_assigned_to_fkey(id, user_id, full_name), campaign:campaigns(id, campaign_name, product_id)';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await requireRole('viewer');
    const { id } = await params;
    const { data, error } = await supabase
      .from('deals')
      .select(SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    return NextResponse.json({ lead: data });
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
      .from('deals')
      .select('status, assigned_to, contact_id, campaign_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!existing)
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const update: Record<string, unknown> = {};

    if (typeof body.title === 'string') {
      const title = body.title.trim();
      if (!title)
        return NextResponse.json(
          { error: 'title cannot be empty' },
          { status: 400 }
        );
      update.title = title;
    }
    if (body.value !== undefined) {
      const parsed = Number(body.value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json(
          { error: 'value must be a non-negative number' },
          { status: 400 }
        );
      }
      update.value = parsed;
    }
    for (const field of ['currency', 'notes', 'outcome'] as const) {
      if (typeof body[field] === 'string' || body[field] === null)
        update[field] = body[field];
    }
    for (const field of ['next_follow_up', 'last_contacted'] as const) {
      if (body[field] !== undefined) {
        if (body[field] !== null && Number.isNaN(Date.parse(body[field]))) {
          return NextResponse.json(
            { error: `${field} must be a valid timestamp` },
            { status: 400 }
          );
        }
        update[field] = body[field];
      }
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
    let nextProfileId: string | null = existing.assigned_to;
    if (body.assigned_to !== undefined) {
      if (body.assigned_to !== null && typeof body.assigned_to !== 'string') {
        return NextResponse.json(
          { error: 'assigned_to must be a string or null' },
          { status: 400 }
        );
      }
      nextProfileId = body.assigned_to;
      update.assigned_to = nextProfileId;
      update.routing_reason = nextProfileId
        ? 'Manually assigned'
        : 'Manually unassigned';
      reassigned = existing.assigned_to !== nextProfileId;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No editable fields provided' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('deals')
      .update(update)
      .eq('id', id)
      .select(SELECT)
      .maybeSingle();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data)
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    // Translate profiles.id -> profiles.user_id for the open_leads
    // RPC (which, like customer_requests/trials, is keyed on
    // auth.uid()/user_id — see migration 002 vs 044/045's differing
    // FK targets, and create-lead.ts's header note on the same gap).
    async function userIdForProfile(
      profileId: string | null
    ): Promise<string | null> {
      if (!profileId) return null;
      const { data: p } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('id', profileId)
        .maybeSingle();
      return p?.user_id ?? null;
    }

    if (reassigned) {
      const [prevUserId, nextUserId] = await Promise.all([
        userIdForProfile(existing.assigned_to),
        userIdForProfile(nextProfileId),
      ]);
      await commitAssignment(supabase, {
        previousBaId: prevUserId,
        nextBaId: nextUserId,
      });
    }

    // Entering a terminal status closes the lead out of anyone's open
    // count; leaving one (an admin correction) reopens it. Only fires
    // on an actual status *change*, and only against whoever is
    // currently assigned (post-update, post-reassignment).
    if (newStatus && newStatus !== existing.status) {
      const wasTerminal = TERMINAL_STATUSES.has(existing.status);
      const isTerminal = TERMINAL_STATUSES.has(newStatus);
      if (wasTerminal !== isTerminal) {
        const assigneeUserId = await userIdForProfile(data.assigned_to);
        if (assigneeUserId) {
          await commitAssignment(supabase, {
            previousBaId: isTerminal ? assigneeUserId : null,
            nextBaId: isTerminal ? null : assigneeUserId,
          });
        }
      }

      if (newStatus === 'CONVERTED') {
        const admin = supabaseAdmin();
        await writeEngagementEvent(admin, {
          accountId,
          memberId: existing.contact_id,
          postId: null,
          campaignId: existing.campaign_id,
          eventType: 'CONVERSION',
          source: 'manual',
        });
        await writeProductInteraction(admin, {
          accountId,
          contactId: existing.contact_id,
          productId:
            (data as { campaign?: { product_id?: string } }).campaign
              ?.product_id ?? null,
          campaignId: existing.campaign_id,
          interactionType: 'conversion',
        });
      }
    }

    return NextResponse.json({ lead: data });
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
      .from('deals')
      .select('assigned_to, status')
      .eq('id', id)
      .maybeSingle();

    const { error } = await supabase.from('deals').delete().eq('id', id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    if (existing?.assigned_to && !TERMINAL_STATUSES.has(existing.status)) {
      const { data: p } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('id', existing.assigned_to)
        .maybeSingle();
      if (p?.user_id) {
        await commitAssignment(supabase, {
          previousBaId: p.user_id,
          nextBaId: null,
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
