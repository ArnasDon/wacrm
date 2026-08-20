// ============================================================
// Shared Lead-creation path (§9.0: `deals` extended into Lead,
// migration 055). Both `POST /api/leads` (a fresh Lead) and
// `POST /api/customer-requests/[id]/convert` (a CustomerRequest
// qualifying into a Lead) go through this one function so routing,
// pipeline/stage resolution, and analytics writes never drift
// between the two entry points (§12).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  routeAssignment,
  commitAssignment,
  resolveMarketRegionFromContact,
} from '@/lib/routing/service';
import { writeEngagementEvent } from '@/lib/whatsapp/engagement';
import { writeProductInteraction } from '@/lib/analytics/product-interaction';

const SPEC_DEFAULT_STAGES = [
  { name: 'New Lead', color: '#3b82f6', position: 0 },
  { name: 'Qualified', color: '#eab308', position: 1 },
  { name: 'Proposal Sent', color: '#f97316', position: 2 },
  { name: 'Negotiation', color: '#8b5cf6', position: 3 },
  { name: 'Won', color: '#22c55e', position: 4 },
];

/**
 * Every Lead is still a `deals` row and `pipeline_id`/`stage_id`
 * remain NOT NULL (migration 001/002) — the Kanban board (Pipelines
 * nav) keeps working against Lead rows unchanged. Reuses the
 * account's first pipeline, seeding the spec-default stages the
 * Pipelines page itself seeds when none exists yet, so a Lead created
 * from this API before anyone ever opened Pipelines still lands
 * somewhere valid.
 */
async function resolveDefaultPipelineStage(
  db: SupabaseClient,
  accountId: string,
  userId: string
): Promise<{ pipelineId: string; stageId: string }> {
  const { data: pipeline } = await db
    .from('pipelines')
    .select('id')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  let pipelineId = pipeline?.id as string | undefined;

  if (!pipelineId) {
    const { data: created, error } = await db
      .from('pipelines')
      .insert({
        user_id: userId,
        account_id: accountId,
        name: 'Sales Pipeline',
      })
      .select('id')
      .single();
    if (error || !created)
      throw new Error('Failed to create a default pipeline for this Lead');
    pipelineId = created.id;
    await db
      .from('pipeline_stages')
      .insert(
        SPEC_DEFAULT_STAGES.map((s) => ({ pipeline_id: pipelineId, ...s }))
      );
  }
  if (!pipelineId)
    throw new Error('Failed to resolve a pipeline for this Lead');

  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!stage) throw new Error('Pipeline has no stages to place this Lead into');
  return { pipelineId, stageId: stage.id };
}

export interface CreateLeadInput {
  accountId: string;
  userId: string;
  contactId: string;
  title: string;
  value?: number;
  currency?: string | null;
  source: string;
  campaignId?: string | null;
  originalContentId?: string | null;
  marketId?: string | null;
  regionId?: string | null;
  notes?: string | null;
}

export async function createLead(db: SupabaseClient, input: CreateLeadInput) {
  const { pipelineId, stageId } = await resolveDefaultPipelineStage(
    db,
    input.accountId,
    input.userId
  );

  let marketId = input.marketId ?? null;
  let regionId = input.regionId ?? null;
  if (!marketId && !regionId) {
    const resolved = await resolveMarketRegionFromContact(db, input.contactId);
    marketId = resolved.marketId;
    regionId = resolved.regionId;
  }

  const decision = await routeAssignment(db, {
    accountId: input.accountId,
    marketId,
    regionId,
  });

  // deals.assigned_to targets profiles(id) — the internal PK, not
  // profiles.user_id/auth.uid() (migration 002) — unlike
  // customer_requests/trials.assigned_ba_id, which target
  // auth.users(id) directly. Translate once here so the rest of the
  // routing service can stay in user_id terms everywhere else.
  let assignedProfileId: string | null = null;
  if (decision.assignedBaId) {
    const { data: profile } = await db
      .from('profiles')
      .select('id')
      .eq('user_id', decision.assignedBaId)
      .maybeSingle();
    assignedProfileId = profile?.id ?? null;
  }

  const { data: lead, error } = await db
    .from('deals')
    .insert({
      user_id: input.userId,
      account_id: input.accountId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      contact_id: input.contactId,
      title: input.title,
      value: input.value ?? 0,
      currency: input.currency ?? null,
      notes: input.notes ?? null,
      status: decision.assignedBaId ? 'ASSIGNED' : 'NEW',
      source: input.source,
      campaign_id: input.campaignId ?? null,
      original_content_id: input.originalContentId ?? null,
      market_id: marketId,
      region_id: regionId,
      assigned_to: assignedProfileId,
      routing_reason: decision.reason,
    })
    .select(
      '*, contact:contacts(id, name, phone), campaign:campaigns(id, campaign_name, product_id)'
    )
    .single();

  if (error) throw new Error(`Failed to create Lead: ${error.message}`);

  if (decision.assignedBaId) {
    await commitAssignment(db, {
      previousBaId: null,
      nextBaId: decision.assignedBaId,
    });
  }

  const admin = supabaseAdmin();
  await writeEngagementEvent(admin, {
    accountId: input.accountId,
    memberId: input.contactId,
    postId: null,
    campaignId: input.campaignId ?? null,
    eventType: 'LEAD',
    source: input.source,
  });

  const productId =
    (lead as { campaign?: { product_id?: string } }).campaign?.product_id ??
    null;
  await writeProductInteraction(admin, {
    accountId: input.accountId,
    contactId: input.contactId,
    productId,
    campaignId: input.campaignId ?? null,
    contentId: input.originalContentId ?? null,
    interactionType: 'lead',
  });

  return lead;
}
