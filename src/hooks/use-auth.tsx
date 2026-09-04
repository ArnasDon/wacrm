"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  isAccountRole,
  type AccountRole,
} from "@/lib/auth/roles";

interface Profile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  /**
   * Opted-in beta feature keys for this account. No current feature
   * reads this — Flows was the last user and went to soft-GA in PR
   * #134 — but the column survives for future beta gates.
   */
  beta_features: string[];
  account_id: string | null;
  account_role: AccountRole | null;
  /** Preferred UI locale, e.g. "en", "es", "ko". Defaults to "en". */
  locale: string;
}

interface AccountSummary {
  id: string;
  name: string;
  /** Default deal currency (ISO-4217). NOT NULL DEFAULT 'USD' in the
   *  DB (migration 021); narrowed to DEFAULT_CURRENCY when absent. */
  default_currency: string;
}

/**
 * Whether we managed to establish what this user may do.
 *
 * `unlinked` and `error` are the states worth surfacing: every RLS
 * policy checks `is_account_member(account_id, …)` and every `useCan`
 * gate returns false without a role, so in both the app silently
 * becomes read-only — the whole UI renders, and nothing saves. That is
 * indistinguishable from a bug unless we say so (issue #471).
 */
export type AccountStatus =
  /** Profile row still in flight. */
  | "loading"
  /** Account + role resolved; normal operation. */
  | "ready"
  /** Signed in, but no profile row / no account / no role on it. */
  | "unlinked"
  /** The profile lookup itself failed after retrying. */
  | "error";

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;

  /**
   * Session-level loading. Flips to false as soon as we know whether
   * a user is signed in, *without* waiting for the profile row. Use
   * this for chrome (sidebar / header) that can render with just the
   * user object.
   */
  loading: boolean;

  /**
   * Profile-row loading. Stays true until `fetchProfile` settles
   * (success, missing row, or error). Code that branches on
   * `profile.beta_features` MUST gate on this.
   */
  profileLoading: boolean;

  signOut: () => Promise<void>;

  /** Re-fetch the current user's profile row. */
  refreshProfile: () => Promise<void>;

  /** Update the current user's preferred UI locale (DB + cookie). */
  updateLocale: (locale: string) => Promise<void>;

  // ----------------------------------------------------------
  // Account-scoped context
  // ----------------------------------------------------------

  /**
   * Outcome of resolving this user's account + role.
   */
  accountStatus: AccountStatus;

  /** Underlying message when accountStatus is error / unlinked. */
  accountStatusDetail: string | null;

  /** Account id the current user belongs to. */
  accountId: string | null;

  /** Role within that account. */
  accountRole: AccountRole | null;

  /** Lightweight account metadata. */
  account: AccountSummary | null;

  /** Account default deal currency. */
  defaultCurrency: string;

  /** True if accountRole === owner. */
  isOwner: boolean;

  /** True if accountRole === admin. */
  isAdmin: boolean;

  /** True if accountRole === agent. */
  isAgent: boolean;

  /** True if accountRole === viewer. */
  isViewer: boolean;

  /** True if the caller can manage members. */
  canManageMembers: boolean;

  /** True if the caller can edit account-wide settings. */
  canEditSettings: boolean;

  /** True if the caller can send messages and edit operational data. */
  canSendMessages: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Attempts at the profile lookup, including the first. */
const PROFILE_FETCH_ATTEMPTS = 2;
const PROFILE_FETCH_RETRY_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Shape of the `profiles` select below. */
interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  role: string | null;
  beta_features: string[] | null;
  account_id: string | null;
  account_role: string | null;
  locale: string | null;
}

/**
 * AuthProvider — wrap this around the dashboard layout.
 * Makes ONE getSession() call for the whole tree instead of one per
 * component, avoiding internal lock contention in the Supabase client.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Why the account/role couldn't be established, when it couldn't.
  // Null on the happy path.
  const [statusDetail, setStatusDetail] = useState<string | null>(null);

  // Tracked separately from `loading`.
  const [profileLoading, setProfileLoading] = useState(true);

  // Tracks the user ID we've successfully initiated/completed fetching
  // a profile for.
  const lastFetchedUserIdRef = useRef<string | null>(null);

  // Shared across init, auth-state-change listener, and refreshProfile().
  const fetchProfile = useCallback(async (userId: string) => {
    const supabase = createClient();

    setProfileLoading(true);
    setStatusDetail(null);
    lastFetchedUserIdRef.current = userId;

    try {
      let data: ProfileRow | null = null;

      for (let attempt = 1; ; attempt++) {
        const result = await supabase
          .from("profiles")
          .select(
            "id, full_name, email, avatar_url, role, beta_features, account_id, account_role, locale",
          )
          .eq("user_id", userId)
          .maybeSingle();

        if (!result.error) {
          data = result.data;
          break;
        }

        const error = result.error;

        console.error("[AuthProvider] fetchProfile error:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });

        // Retry temporary profile-fetch failures.
        if (attempt < PROFILE_FETCH_ATTEMPTS) {
          await sleep(PROFILE_FETCH_RETRY_MS);
          continue;
        }

        lastFetchedUserIdRef.current = null;
        setStatusDetail(error.message);
        return;
      }

      if (data) {
        // Load the account with a plain lookup by id instead of an
        // embedded FK join.
        let accountRow: AccountSummary | null = null;

        if (data.account_id) {
          const { data: account, error: accountErr } = await supabase
            .from("accounts")
            .select("id, name, default_currency")
            .eq("id", data.account_id)
            .maybeSingle();

          if (accountErr) {
            console.error("[AuthProvider] fetchAccount error:", {
              message: accountErr.message,
              details: accountErr.details,
              hint: accountErr.hint,
              code: accountErr.code,
            });
          } else if (account) {
            accountRow = {
              id: account.id,
              name: account.name,
              default_currency:
                account.default_currency ?? DEFAULT_CURRENCY,
            };
          }
        }

        // Narrow the DB enum into our AccountRole union.
        const accountRole = isAccountRole(data.account_role)
          ? data.account_role
          : null;

        setProfile({
          id: data.id,
          full_name: data.full_name,
          email: data.email,
          avatar_url: data.avatar_url,
          role: data.role,
          beta_features: data.beta_features ?? [],
          account_id: data.account_id ?? null,
          account_role: accountRole,
          locale: data.locale ?? "en",
        });

        setAccount(accountRow);

        // The row exists but has no tenancy information.
        if (!data.account_id || !accountRole) {
          setStatusDetail(
            `profile ${data.id} has no ${
              !data.account_id ? "account_id" : "account_role"
            }`,
          );
        }
      } else {
        lastFetchedUserIdRef.current = null;
        setStatusDetail("no profiles row for the signed-in user");
      }
    } catch (err) {
      console.error("[AuthProvider] fetchProfile threw:", err);
      lastFetchedUserIdRef.current = null;
      setStatusDetail(
        err instanceof Error ? err.message : "profile fetch failed",
      );
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    const safetyTimer = setTimeout(() => {
      if (mounted) {
        console.warn("[AuthProvider] getSession() timed out after 3s");
        setLoading(false);
        setProfileLoading(false);
      }
    }, 3000);

    const init = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error(
            "[AuthProvider] getSession error:",
            error.message,
          );
        }

        if (!mounted) return;

        const currentUser = session?.user ?? null;
        setUser(currentUser);

        if (currentUser) {
          // Don't block session loading on profile fetch.
          fetchProfile(currentUser.id);
        } else {
          // No user → no profile to load.
          setProfileLoading(false);
        }
      } catch (err) {
        console.error("[AuthProvider] init threw:", err);
      } finally {
        if (mounted) {
          setLoading(false);
        }

        clearTimeout(safetyTimer);
      }
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        if (currentUser.id !== lastFetchedUserIdRef.current) {
          fetchProfile(currentUser.id);
        }
      } else {
        lastFetchedUserIdRef.current = null;
        setProfile(null);
        setAccount(null);
        setStatusDetail(null);
        setProfileLoading(false);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    const supabase = createClient();

    await supabase.auth.signOut();

    setUser(null);
    setProfile(null);
    setAccount(null);
    setStatusDetail(null);

    window.location.href = "/login";
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user?.id) return;

    await fetchProfile(user.id);
  }, [user?.id, fetchProfile]);

  const updateLocale = useCallback(
    async (locale: string, reload = true) => {
      if (!user?.id) return;

      const supabase = createClient();

      const { error } = await supabase
        .from("profiles")
        .update({ locale })
        .eq("user_id", user.id);

      if (error) {
        console.error(
          "[AuthProvider] updateLocale error:",
          error.message,
        );
        return;
      }

      // Update local state immediately.
      setProfile((prev) =>
        prev ? { ...prev, locale } : prev,
      );

      // Also set a cookie so i18n/request.ts picks it up on next SSR.
      const secure =
        location.protocol === "https:" ? ";Secure" : "";

      document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=31536000;SameSite=Lax${secure}`;

      if (reload) {
        // Small delay so the cookie flush finishes before navigation.
        setTimeout(() => {
          location.href = location.href;
        }, 50);
      }
    },
    [user?.id],
  );

  // Derive the role booleans once per profile change.
  const derived = useMemo(() => {
    const role = profile?.account_role ?? null;

    return {
      accountRole: role,
      accountId: profile?.account_id ?? null,
      isOwner: role === "owner",
      isAdmin: role === "admin",
      isAgent: role === "agent",
      isViewer: role === "viewer",
      canManageMembers: role
        ? canManageMembersFor(role)
        : false,
      canEditSettings: role
        ? canEditSettingsFor(role)
        : false,
      canSendMessages: role
        ? canSendMessagesFor(role)
        : false,
    };
  }, [profile?.account_role, profile?.account_id]);

  // Signed out is not a broken account.
  const accountStatus: AccountStatus = !user
    ? "loading"
    : profileLoading
      ? "loading"
      : !profile
        ? "error"
        : derived.accountId && derived.accountRole
          ? "ready"
          : "unlinked";

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileLoading,
        signOut,
        refreshProfile,
        updateLocale,
        account,
        defaultCurrency:
          account?.default_currency ?? DEFAULT_CURRENCY,
        accountStatus,
        accountStatusDetail: statusDetail,
        ...derived,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth — read the shared auth state from context.
 * Must be used inside an <AuthProvider>.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    // Fallback for components rendered outside the provider.
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,

      signOut: async () => {
        window.location.href = "/login";
      },

      refreshProfile: async () => {},

      updateLocale: async () => {},

      account: null,
      defaultCurrency: DEFAULT_CURRENCY,

      // Outside the provider there is nothing to resolve yet.
      accountStatus: "loading",
      accountStatusDetail: null,

      accountId: null,
      accountRole: null,

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