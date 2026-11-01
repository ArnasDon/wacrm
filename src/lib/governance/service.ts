import { SupabaseClient } from '@supabase/supabase-js';
import type {
  ApprovalRequest,
  ApprovalRequestType,
  InventoryItem,
  AuditLogEntry,
} from './types';

/**
 * Record an immutable audit log entry for governance and compliance.
 */
export async function logAuditEvent(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    details?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<AuditLogEntry | null> {
  const { data, error } = await supabase
    .from('audit_logs')
    .insert({
      account_id: params.accountId,
      actor_id: params.actorId || null,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId,
      details: params.details || {},
      ip_address: params.ipAddress || null,
      user_agent: params.userAgent || null,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to write audit log entry:', error);
    return null;
  }

  return data as AuditLogEntry;
}

/**
 * Create a new approval request (e.g. price override, refund, discount, contract).
 */
export async function createApprovalRequest(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    requestedBy: string;
    requestType: ApprovalRequestType;
    entityType: string;
    entityId: string;
    requestedPayload: Record<string, unknown>;
  }
): Promise<ApprovalRequest> {
  const { data, error } = await supabase
    .from('approval_requests')
    .insert({
      account_id: params.accountId,
      requested_by: params.requestedBy,
      request_type: params.requestType,
      entity_type: params.entityType,
      entity_id: params.entityId,
      requested_payload: params.requestedPayload,
      status: 'pending',
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to create approval request');
  }

  // Record audit log for governance
  await logAuditEvent(supabase, {
    accountId: params.accountId,
    actorId: params.requestedBy,
    action: 'approval.requested',
    entityType: 'approval_request',
    entityId: data.id,
    details: {
      requestType: params.requestType,
      entityType: params.entityType,
      entityId: params.entityId,
    },
  });

  return data as ApprovalRequest;
}

/**
 * Review an approval request (approve or reject) adhering strictly to the 4-eyes principle:
 * The reviewer CANNOT be the same user who initiated the request.
 */
export async function reviewApprovalRequest(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    requestId: string;
    reviewerId: string;
    status: 'approved' | 'rejected';
    notes?: string;
    rejectionReason?: string;
  }
): Promise<ApprovalRequest> {
  // Fetch existing request to enforce 4-eyes principle
  const { data: request, error: fetchErr } = await supabase
    .from('approval_requests')
    .select('*')
    .eq('id', params.requestId)
    .eq('account_id', params.accountId)
    .single();

  if (fetchErr || !request) {
    throw new Error('Approval request not found');
  }

  if (request.status !== 'pending') {
    throw new Error(`Request has already been ${request.status}`);
  }

  // 4-Eyes Principle Verification: A user cannot approve their own financial request
  if (request.requested_by === params.reviewerId) {
    throw new Error('4-Eyes Violation: Initiators cannot review their own approval requests');
  }

  const updates: Record<string, unknown> = {
    status: params.status,
    reviewed_by: params.reviewerId,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (params.status === 'approved') {
    updates.approval_notes = params.notes || null;
  } else {
    updates.rejection_reason = params.rejectionReason || params.notes || 'Rejected by manager';
  }

  const { data, error: updateErr } = await supabase
    .from('approval_requests')
    .update(updates)
    .eq('id', params.requestId)
    .eq('account_id', params.accountId)
    .eq('status', 'pending')
    .select()
    .single();

  if (updateErr || !data) {
    throw new Error('Approval request has already been reviewed or is no longer pending');
  }

  // Record audit trail
  await logAuditEvent(supabase, {
    accountId: params.accountId,
    actorId: params.reviewerId,
    action: `approval.${params.status}`,
    entityType: 'approval_request',
    entityId: params.requestId,
    details: {
      previousStatus: request.status,
      newStatus: params.status,
      notes: params.notes,
      rejectionReason: params.rejectionReason,
    },
  });

  return data as ApprovalRequest;
}

/**
 * Update or adjust inventory level for a product at a given warehouse or store location.
 */
export async function adjustInventory(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    actorId?: string;
    productId: string;
    locationName?: string;
    quantityOnHandDelta?: number;
    newQuantityOnHand?: number;
    reorderThreshold?: number;
  }
): Promise<InventoryItem> {
  const location = params.locationName || 'Main Warehouse';

  let result: InventoryItem | null = null;

  // 1. Prefer atomic RPC when available to prevent check-then-write races
  if (typeof supabase.rpc === 'function') {
    try {
      const { data: rpcData, error: rpcErr } = await supabase
        .rpc('adjust_inventory_quantity', {
          p_account_id: params.accountId,
          p_product_id: params.productId,
          p_location_name: location,
          p_delta: params.quantityOnHandDelta ?? null,
          p_new_quantity: params.newQuantityOnHand ?? null,
          p_reorder_threshold: params.reorderThreshold ?? null,
        })
        .maybeSingle();

      if (!rpcErr && rpcData) {
        result = rpcData as InventoryItem;
      } else if (rpcErr) {
        if (/insufficient stock/i.test(rpcErr.message)) {
          throw new Error(rpcErr.message);
        }
      }
    } catch (rpcCatchErr) {
      if (rpcCatchErr instanceof Error && /insufficient stock/i.test(rpcCatchErr.message)) {
        throw rpcCatchErr;
      }
      // Fall through to upsert / query
    }
  }

  // 2. If newQuantityOnHand is set and RPC wasn't executed, perform atomic upsert
  if (!result && params.newQuantityOnHand !== undefined) {
    try {
      const { data: upserted, error: upsertErr } = await supabase
        .from('inventory_items')
        .upsert(
          {
            account_id: params.accountId,
            product_id: params.productId,
            location_name: location,
            quantity_on_hand: Math.max(0, params.newQuantityOnHand),
            reorder_threshold: Math.max(0, params.reorderThreshold ?? 5),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'product_id,location_name' }
        )
        .select('*, product:products(id, title, sku, price, currency)')
        .maybeSingle();

      if (!upsertErr && upserted) {
        result = upserted as InventoryItem;
      }
    } catch {
      // Fall through to query
    }
  }

  // 3. Fallback for non-upsert mocks or environments
  if (!result) {
    const { data: existing } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('account_id', params.accountId)
      .eq('product_id', params.productId)
      .eq('location_name', location)
      .maybeSingle();

    if (!existing) {
      const initialQty = params.newQuantityOnHand !== undefined
        ? Math.max(0, params.newQuantityOnHand)
        : Math.max(0, params.quantityOnHandDelta || 0);

      const { data: inserted, error: insertErr } = await supabase
        .from('inventory_items')
        .insert({
          account_id: params.accountId,
          product_id: params.productId,
          location_name: location,
          quantity_on_hand: initialQty,
          quantity_reserved: 0,
          reorder_threshold: params.reorderThreshold ?? 5,
        })
        .select('*, product:products(id, title, sku, price, currency)')
        .single();

      if (insertErr || !inserted) {
        throw new Error(insertErr?.message || 'Failed to create inventory item');
      }
      result = inserted as InventoryItem;
    } else {
      let nextQty = existing.quantity_on_hand;
      if (params.newQuantityOnHand !== undefined) {
        nextQty = Math.max(0, params.newQuantityOnHand);
      } else if (params.quantityOnHandDelta !== undefined) {
        nextQty = Math.max(0, existing.quantity_on_hand + params.quantityOnHandDelta);
      }

      const updatePayload: Record<string, unknown> = {
        quantity_on_hand: nextQty,
        updated_at: new Date().toISOString(),
      };
      if (params.reorderThreshold !== undefined) {
        updatePayload.reorder_threshold = Math.max(0, params.reorderThreshold);
      }

      const { data: updated, error: updateErr } = await supabase
        .from('inventory_items')
        .update(updatePayload)
        .eq('id', existing.id)
        .select('*, product:products(id, title, sku, price, currency)')
        .single();

      if (updateErr || !updated) {
        throw new Error(updateErr?.message || 'Failed to update inventory');
      }
      result = updated as InventoryItem;
    }
  }

  // Audit trail for inventory mutation
  await logAuditEvent(supabase, {
    accountId: params.accountId,
    actorId: params.actorId,
    action: 'inventory.adjusted',
    entityType: 'inventory_item',
    entityId: result.id,
    details: {
      productId: params.productId,
      locationName: location,
      quantityOnHand: result.quantity_on_hand,
    },
  });

  return result;
}
