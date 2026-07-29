// ============================================================
// platform_admin_audit_log writer — every write /api/platform/*
// route calls this after (or right before) it does the actual
// mutation. See migration 043 for the table + its RLS (platform
// admins can read; nothing can write except the service-role client
// this function is always called with).
//
// Deliberately fire-and-forget-safe but never silent: a logging
// failure is reported to the console but never throws, so an audit
// hiccup can't block (or appear to block, then partially retry) the
// actual admin action. It's still called BEFORE returning a success
// response from every route, so a failure is at least visible in
// server logs immediately.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export type PlatformAdminAction =
  | "organization.update"
  | "organization.status_update"
  | "organization.delete"
  | "account.update"
  | "account.email_update"
  | "account.password_reset_link_sent"
  | "account.password_set_directly"
  | "account.unlink"
  | "account.delete";

export interface LogPlatformAdminActionParams {
  adminUserId: string;
  action: PlatformAdminAction;
  targetType: "organization" | "account";
  targetId: string | null;
  /** Never include a password value here — see the route-level
   *  comments on the reset-password endpoint. */
  metadata?: Record<string, unknown>;
}

export async function logPlatformAdminAction(
  admin: AdminClient,
  params: LogPlatformAdminActionParams,
): Promise<void> {
  const { error } = await admin.from("platform_admin_audit_log").insert({
    admin_user_id: params.adminUserId,
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId,
    metadata: params.metadata ?? {},
  });

  if (error) {
    console.error("[platform audit log] failed to record action:", params.action, error);
  }
}
