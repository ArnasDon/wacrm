'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { authClient } from '@/lib/auth/client';
import type { LocalUser as User } from '@/lib/auth/client';
import { DEFAULT_CURRENCY } from '@/lib/currency';
import {
  canEditSettings as canEditSettingsFor,
  canManageMembers as canManageMembersFor,
  canSendMessages as canSendMessagesFor,
  isAccountRole,
  type AccountRole,
} from '@/lib/auth/roles';

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
  | 'loading'
  /** Account + role resolved; normal operation. */
  | 'ready'
  /** Signed in, but no profile row / no account / no role on it. */
  | 'unlinked'
  /** The profile lookup itself failed after retrying. */
  | 'error';

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
   * `profile.beta_features` MUST gate on this — otherwise it sees the
   * `{ loading: false, profile: null }` window during initial load
   * and may take the "not opted in" branch incorrectly.
   */
  profileLoading: boolean;
  signOut: () => Promise<void>;
  /** Re-fetch the current user's profile row — call after a save from
   *  the settings form so header/sidebar reflect the change without a
   *  full page reload. */
  refreshProfile: () => Promise<void>;

  // ----------------------------------------------------------
  // Account-scoped context (added by the account-sharing series)
  //
  // All of these are nullable until `profileLoading` is false.
  // After the profile resolves they're guaranteed to be set,
  // because migration 017 made `account_id` / `account_role`
  // NOT NULL on `profiles`.
  // ----------------------------------------------------------

  /**
   * Outcome of resolving this user's account + role. Anything other
   * than `ready` means writes will be rejected — render
   * `<AccountAccessAlert />` (already mounted in the dashboard shell)
   * rather than letting the user discover it one failed save at a time.
   */
  accountStatus: AccountStatus;
  /** Underlying message when `accountStatus` is 'error' / 'unlinked'. */
  accountStatusDetail: string | null;
  /** Account id the current user belongs to. Null while loading. */
  accountId: string | null;
  /** Role within that account. Null while loading. */
  accountRole: AccountRole | null;
  /** Lightweight account meta — id + name + default_currency. Null while loading. */
  account: AccountSummary | null;
  /** Account default deal currency. Falls back to DEFAULT_CURRENCY
   *  while loading or when no account is resolved, so callers can use
   *  it unconditionally. */
  defaultCurrency: string;
  /** True if `accountRole === 'owner'`. */
  isOwner: boolean;
  /** True if `accountRole === 'admin'` (does NOT include owner — use canManageMembers for "admin or above"). */
  isAdmin: boolean;
  /** True if `accountRole === 'agent'`. */
  isAgent: boolean;
  /** True if `accountRole === 'viewer'`. */
  isViewer: boolean;
  /** True if the caller can manage members (admin+). */
  canManageMembers: boolean;
  /** True if the caller can edit account-wide settings (admin+). */
  canEditSettings: boolean;
  /** True if the caller can send messages and edit operational data (agent+). */
  canSendMessages: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  const user = session.data?.user ?? null;
  const userId = user?.id;
  const loading = session.isPending;
  const [snapshot, setSnapshot] = useState<{
    userId: string;
    profile: Profile | null;
    account: AccountSummary | null;
    detail: string | null;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const response = await fetch('/api/auth-context', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? 'Unable to load account.');
        const profile = body.profile as Profile | null;
        if (profile && !isAccountRole(profile.account_role))
          profile.account_role = null;
        if (active)
          setSnapshot({
            userId: userId!,
            profile,
            account: body.account ?? null,
            detail: null,
          });
      } catch (error) {
        if (active)
          setSnapshot({
            userId: userId!,
            profile: null,
            account: null,
            detail:
              error instanceof Error
                ? error.message
                : 'Unable to load account.',
          });
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [userId, refresh]);
  // Never expose a previous identity's permissions while a new fetch is pending.
  const current = snapshot?.userId === userId ? snapshot : null;
  const profile = current?.profile ?? null;
  const account = current?.account ?? null;
  const statusDetail = current?.detail ?? null;
  const profileLoading = Boolean(userId && !current);
  const refreshProfile = useCallback(async () => {
    setRefresh((value) => value + 1);
  }, []);
  const signOut = useCallback(async () => {
    const result = await authClient.signOut();
    if (result.error)
      throw new Error(result.error.message ?? 'Unable to sign out.');
    setSnapshot(null);
    window.location.href = '/login';
  }, []);

  // Derive the role booleans once per profile change rather than on
  // every consumer render. Cheap regardless, but the memo also gives
  // each derived value a stable identity for React.memo / useEffect
  // dependencies downstream.
  const derived = useMemo(() => {
    const role = profile?.account_role ?? null;
    return {
      accountRole: role,
      accountId: profile?.account_id ?? null,
      isOwner: role === 'owner',
      isAdmin: role === 'admin',
      isAgent: role === 'agent',
      isViewer: role === 'viewer',
      canManageMembers: role ? canManageMembersFor(role) : false,
      canEditSettings: role ? canEditSettingsFor(role) : false,
      canSendMessages: role ? canSendMessagesFor(role) : false,
    };
  }, [profile?.account_role, profile?.account_id]);

  // Signed out is not a broken account — the shell redirects to /login
  // before anything reads this.
  const accountStatus: AccountStatus = !user
    ? 'loading'
    : profileLoading
      ? 'loading'
      : !profile
        ? 'error'
        : derived.accountId && derived.accountRole
          ? 'ready'
          : 'unlinked';

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        profileLoading,
        signOut,
        refreshProfile,
        account,
        defaultCurrency: account?.default_currency ?? DEFAULT_CURRENCY,
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
    // Fallback for components rendered outside the provider (shouldn't
    // happen in normal flow, but don't crash the page). Account state
    // collapses to least-privileged null — every `canX` boolean is
    // false so UI gates fail closed.
    return {
      user: null,
      profile: null,
      loading: false,
      profileLoading: false,
      signOut: async () => {
        window.location.href = '/login';
      },
      refreshProfile: async () => {},
      account: null,
      defaultCurrency: DEFAULT_CURRENCY,
      // Outside the provider there is nothing to resolve yet — 'loading'
      // keeps the access alert from firing on, say, the login page.
      accountStatus: 'loading',
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
