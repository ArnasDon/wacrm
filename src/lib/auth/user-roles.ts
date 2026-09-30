// ============================================================
// User-type helpers — pure, unit-testable, no I/O.
//
// Orthogonal to `AccountRole` (owner/admin/agent/viewer), which
// describes what a user may do *inside an account*. `UserRole`
// describes where the user sits in the Partner hierarchy and lives
// in `profiles.role` (migration 058):
//
//   'User'    — a Main User. May invite and manage Partners.
//   'SubUser' — a Partner, created from a Main User's invitation.
//               Same dashboard and CRM features, no Partners module.
//
// Status (`profiles.status`) is 'ACTIVE' | 'DISABLED'. A DISABLED
// user is denied by the database (is_account_member) and by
// `getCurrentAccount`, and is banned in Supabase Auth.
// ============================================================

export type UserRole = "User" | "SubUser";
export type UserStatus = "ACTIVE" | "DISABLED";

export const MAIN_USER_ROLE: UserRole = "User";
export const SUB_USER_ROLE: UserRole = "SubUser";

export function isUserRole(value: unknown): value is UserRole {
  return value === "User" || value === "SubUser";
}

export function isUserStatus(value: unknown): value is UserStatus {
  return value === "ACTIVE" || value === "DISABLED";
}

/** Only Main Users may list, invite, resend, revoke, enable or disable Partners. */
export function canManagePartners(role: UserRole | null | undefined): boolean {
  return role === MAIN_USER_ROLE;
}
