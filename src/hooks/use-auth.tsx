"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  isAccountRole,
  type AccountRole,
} from "@/lib/auth/roles";

// ============================================================
// Client auth state, backed by GET /api/auth/me (MongoDB sessions).
//
// The context shape is unchanged from the Supabase era so existing
// consumers (sidebar, header, settings, gates) keep working. UI gates
// here are cosmetic — the server re-checks the role on every call.
// ============================================================

export interface SessionUser {
  id: string;
  email: string;
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
}

interface AccountSummary {
  id: string;
  name: string;
  currency: string;
  hasLogo: boolean;
  logoVersion: number;
}

interface AuthContextValue {
  user: SessionUser | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  accountId: string | null;
  accountRole: AccountRole | null;
  /** Runs the whole platform, not just this account. */
  platformAdmin: boolean;
  /** Currently working inside a merchant's account from the admin area. */
  actingAsAccount: boolean;
  account: AccountSummary | null;
  isOwner: boolean;
  isAdmin: boolean;
  isAgent: boolean;
  isViewer: boolean;
  canManageMembers: boolean;
  canEditSettings: boolean;
  canSendMessages: boolean;
}

interface MeResponse {
  user: { id: string; email: string; fullName: string | null; avatarUrl: string | null };
  role: string;
  account: AccountSummary;
  platformAdmin?: boolean;
  actingAsAccount?: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [platform, setPlatform] = useState({ admin: false, acting: false });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        setUser(null);
        setProfile(null);
        setAccount(null);
        return;
      }
      const me = (await res.json()) as MeResponse;
      const role = isAccountRole(me.role) ? me.role : null;
      setPlatform({ admin: !!me.platformAdmin, acting: !!me.actingAsAccount });
      setUser({ id: me.user.id, email: me.user.email });
      setProfile({
        id: me.user.id,
        full_name: me.user.fullName,
        email: me.user.email,
        avatar_url: me.user.avatarUrl,
        role,
        beta_features: [],
        account_id: me.account.id,
        account_role: role,
      });
      setAccount(me.account);
    } catch (err) {
      console.error("[AuthProvider] /api/auth/me failed:", err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setProfile(null);
    setAccount(null);
    window.location.href = "/login";
  }, []);

  const derived = useMemo(() => {
    const role = profile?.account_role ?? null;
    return {
      accountRole: role,
      platformAdmin: platform.admin,
      actingAsAccount: platform.acting,
      accountId: profile?.account_id ?? null,
      isOwner: role === "owner",
      isAdmin: role === "admin",
      isAgent: role === "agent",
      isViewer: role === "viewer",
      canManageMembers: role ? canManageMembersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
    };
  }, [profile?.account_role, profile?.account_id, platform.admin, platform.acting]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileLoading: loading,
        signOut,
        refreshProfile: load,
        account,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        window.location.href = "/login";
      },
      refreshProfile: async () => {},
      account: null,
      accountId: null,
      accountRole: null,
      platformAdmin: false,
      actingAsAccount: false,
      isOwner: false,
      isAdmin: false,
      isAgent: false,
      isViewer: false,
      canManageMembers: false,
      canEditSettings: false,
      canSendMessages: false,
    };
  }
  return ctx;
}
