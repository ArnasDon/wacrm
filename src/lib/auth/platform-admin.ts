import { createClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "./account";

export interface PlatformAdminContext {
  userId: string;
  isPlatformAdmin: boolean;
}

/**
 * Check if a given user ID (or the current session user if omitted) is a platform admin.
 */
export async function isPlatformAdmin(userId?: string): Promise<boolean> {
  const supabase = await createClient();
  let targetUserId = userId;

  if (!targetUserId) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    targetUserId = user.id;
  }

  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (error || !data) {
    return false;
  }

  return true;
}

/**
 * Enforce that the caller is an authenticated platform admin.
 * Throws UnauthorizedError if unauthenticated.
 * Throws ForbiddenError if authenticated user is not a platform admin.
 */
export async function requirePlatformAdmin(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new UnauthorizedError("Authentication required");
  }

  const isAdmin = await isPlatformAdmin(user.id);
  if (!isAdmin) {
    throw new ForbiddenError("Platform admin access required");
  }

  return { userId: user.id };
}
