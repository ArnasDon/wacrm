// ============================================================
// Partners — server-side data access shared by the API routes.
//
// Uses the service-role client because partner rows span tenants
// (a SubUser has their own account, so the Main User's RLS scope
// can't read their profile). The trade-off is the discipline that
// comes with it: EVERY query here is filtered by the authenticated
// Main User's id (`parentUserId`), which callers take from
// `requireMainUser()` — never from the request.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { sendEmail } from "@/lib/email/send";
import { buildPartnerInvitationEmail } from "./email";
import {
  effectiveInvitationStatus,
  partnerSignupUrl,
  type PartnerInvitationStatus,
} from "./invitations";
import type { UserStatus } from "@/lib/auth/user-roles";

export interface PartnerInvitationRow {
  id: string;
  parent_user_id: string;
  email: string;
  company_name: string;
  phone: string;
  status: PartnerInvitationStatus;
  expires_at: string;
  used_at: string | null;
  created_user_id: string | null;
  last_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One row of the Partners page. `id` is the invitation id. */
export interface PartnerListItem {
  id: string;
  companyName: string;
  partnerName: string | null;
  email: string;
  phone: string;
  /** Account status of the SubUser; null until the invitation is accepted. */
  status: UserStatus | null;
  invitationStatus: PartnerInvitationStatus;
  invitationSentAt: string | null;
  invitationExpiresAt: string;
  createdAt: string;
  userId: string | null;
}

const INVITATION_COLUMNS =
  "id, parent_user_id, email, company_name, phone, status, expires_at, used_at, created_user_id, last_sent_at, created_at, updated_at";

export function partnersDb(): SupabaseClient {
  return supabaseAdmin();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params are untrusted; reject non-UUIDs before they reach Postgres. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Best-effort client IP for per-IP rate limits on the public endpoints. */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

/** Persist PENDING → EXPIRED for rows past `expires_at`. Idempotent. */
export async function expireStaleInvitations(
  db: SupabaseClient,
  filter: { parentUserId?: string; email?: string },
): Promise<void> {
  let q = db
    .from("partner_invitations")
    .update({ status: "EXPIRED" })
    .eq("status", "PENDING")
    .lte("expires_at", new Date().toISOString());
  if (filter.parentUserId) q = q.eq("parent_user_id", filter.parentUserId);
  if (filter.email) q = q.eq("email", filter.email);
  const { error } = await q;
  if (error) console.error("[partners] expireStaleInvitations failed:", error);
}

export async function listPartners(
  db: SupabaseClient,
  parentUserId: string,
): Promise<PartnerListItem[]> {
  await expireStaleInvitations(db, { parentUserId });

  const { data: invitations, error } = await db
    .from("partner_invitations")
    .select(INVITATION_COLUMNS)
    .eq("parent_user_id", parentUserId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = (invitations ?? []) as PartnerInvitationRow[];
  const userIds = rows.map((r) => r.created_user_id).filter((id): id is string => !!id);

  const profilesById = new Map<string, { full_name: string | null; status: UserStatus }>();
  if (userIds.length > 0) {
    const { data: profiles, error: profErr } = await db
      .from("profiles")
      .select("user_id, full_name, status")
      .in("user_id", userIds)
      // Ownership re-checked on the profile side too: a SubUser row is
      // only shown if it really belongs to this Main User.
      .eq("parent_user_id", parentUserId)
      .eq("role", "SubUser");
    if (profErr) throw profErr;
    for (const p of profiles ?? []) {
      profilesById.set(p.user_id as string, {
        full_name: (p.full_name as string | null) ?? null,
        status: p.status as UserStatus,
      });
    }
  }

  return rows.map((r) => {
    const profile = r.created_user_id ? profilesById.get(r.created_user_id) : undefined;
    return {
      id: r.id,
      companyName: r.company_name,
      partnerName: profile?.full_name || null,
      email: r.email,
      phone: r.phone,
      status: profile?.status ?? null,
      invitationStatus: effectiveInvitationStatus(r.status, r.expires_at),
      invitationSentAt: r.last_sent_at,
      invitationExpiresAt: r.expires_at,
      createdAt: r.created_at,
      userId: profile ? r.created_user_id : null,
    };
  });
}

/** Load one invitation, scoped to its owner. Null when not theirs. */
export async function getOwnedInvitation(
  db: SupabaseClient,
  parentUserId: string,
  invitationId: string,
): Promise<PartnerInvitationRow | null> {
  const { data, error } = await db
    .from("partner_invitations")
    .select(INVITATION_COLUMNS)
    .eq("id", invitationId)
    .eq("parent_user_id", parentUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as PartnerInvitationRow | null) ?? null;
}

/** True when a wacrm account already uses this (lower-cased) email. */
export async function accountExistsForEmail(
  db: SupabaseClient,
  email: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("profiles")
    .select("user_id")
    .ilike("email", escapeLike(email))
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface InviterIdentity {
  name: string;
  email: string;
}

export async function getInviterIdentity(
  db: SupabaseClient,
  userId: string,
): Promise<InviterIdentity> {
  const { data } = await db
    .from("profiles")
    .select("full_name, email")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    name: (data?.full_name as string | null) ?? "",
    email: (data?.email as string | null) ?? "",
  };
}

export interface DeliveryResult {
  emailSent: boolean;
  /**
   * Returned to the inviter ONLY when the email could not be sent,
   * so they can share the link another way (same model as the team
   * invite links). Never persisted.
   */
  signupUrl?: string;
}

export async function deliverPartnerInvitation(args: {
  to: string;
  companyName: string;
  inviter: InviterIdentity;
  token: string;
  baseUrl: string;
  expiryHours: number;
}): Promise<DeliveryResult> {
  const signupUrl = partnerSignupUrl(args.token, args.baseUrl);
  const result = await sendEmail(
    buildPartnerInvitationEmail({
      to: args.to,
      companyName: args.companyName,
      inviterName: args.inviter.name,
      inviterEmail: args.inviter.email,
      signupUrl,
      expiryHours: args.expiryHours,
    }),
  );
  return result.sent ? { emailSent: true } : { emailSent: false, signupUrl };
}
