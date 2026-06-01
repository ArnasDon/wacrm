"use client";

import { useAuth } from "@/hooks/use-auth";
import {
  canDeleteAccount,
  canEditSettings,
  canManageMembers,
  canSendMessages,
  canTransferOwnership,
  canViewOnly,
} from "@/lib/auth/roles";

/**
 * Typed action keys for `useCan`. Adding a capability = one new
 * entry here + one new case in the switch below + (usually) one
 * new predicate in `@/lib/auth/roles`. Keeping the list closed
 * lets the compiler catch typos at every call site.
 */
export type CanAction =
  | "manage-members"
  | "edit-settings"
  | "send-messages"
  | "view-only"
  | "delete-account"
  | "transfer-ownership";

/**
 * Inline alternative to `<RequireRole>` for places that need a
 * boolean rather than a render conditional — typically disabled-
 * state on buttons, the readOnly flag on inputs, or controlling
 * tooltip copy ("Read-only" vs the action label).
 *
 * Returns `false` while `profileLoading` is true so transient
 * "you can!" flashes never appear to under-privileged users.
 *
 * Example:
 *   const canEdit = useCan("edit-settings");
 *   <Button disabled={!canEdit} title={canEdit ? "Save" : "Read-only"} />
 */
export function useCan(action: CanAction): boolean {
  const { profileLoading, accountRole } = useAuth();
  if (profileLoading || !accountRole) return false;

  switch (action) {
    case "manage-members":
      return canManageMembers(accountRole);
    case "edit-settings":
      return canEditSettings(accountRole);
    case "send-messages":
      return canSendMessages(accountRole);
    case "view-only":
      return canViewOnly(accountRole);
    case "delete-account":
      return canDeleteAccount(accountRole);
    case "transfer-ownership":
      return canTransferOwnership(accountRole);
    default: {
      // Exhaustiveness check — adding a new `CanAction` without a
      // case here fails the typecheck because TS narrows `action`
      // to `never` in this branch. The runtime throw is unreachable
      // for valid inputs; it only fires if someone bypasses the
      // type system at the call site (e.g. with a wrong-typed cast).
      const _exhaustive: never = action;
      throw new Error(`Unknown CanAction: ${String(_exhaustive)}`);
    }
  }
}
