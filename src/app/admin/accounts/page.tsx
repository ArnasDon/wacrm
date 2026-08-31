"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Building2,
  Users,
  Wifi,
  WifiOff,
  Search,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";

interface AccountItem {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
  member_count: number;
  whatsapp_status: string;
}

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchAccounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/accounts");
      if (!res.ok) {
        throw new Error("Failed to load accounts");
      }
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error fetching accounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const filteredAccounts = useMemo(() => {
    if (!search.trim()) return accounts;
    const q = search.toLowerCase();
    return accounts.filter(
      (a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  const stats = useMemo(() => {
    const totalAccounts = accounts.length;
    const connectedWhatsApp = accounts.filter(
      (a) => a.whatsapp_status === "connected"
    ).length;
    const totalMembers = accounts.reduce((sum, a) => sum + a.member_count, 0);

    return { totalAccounts, connectedWhatsApp, totalMembers };
  }, [accounts]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Business Accounts
          </h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Overview of all tenant accounts, member seats, and WhatsApp connection status across the platform.
          </p>
        </div>
        <button
          onClick={fetchAccounts}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 self-start sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total Accounts</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">
            {loading ? "..." : stats.totalAccounts}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">WhatsApp Connected</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Wifi className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">
              {loading ? "..." : stats.connectedWhatsApp}
            </span>
            <span className="text-xs text-muted-foreground">
              {stats.totalAccounts > 0
                ? `${Math.round((stats.connectedWhatsApp / stats.totalAccounts) * 100)}% of total`
                : "0%"}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total User Members</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-foreground">
            {loading ? "..." : stats.totalMembers}
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search account name or ID..."
            className="pl-9 text-xs sm:text-sm"
          />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Accounts Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="border-b border-border bg-muted/50 text-muted-foreground font-medium">
              <tr>
                <th className="px-4 py-3">Account Name</th>
                <th className="px-4 py-3">Account ID</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">WhatsApp Status</th>
                <th className="px-4 py-3">Created Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    <div className="inline-flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      Loading accounts...
                    </div>
                  </td>
                </tr>
              ) : filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No accounts found.
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-primary shrink-0" />
                        <span>{acc.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {acc.id}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                        <Users className="h-3 w-3 text-muted-foreground" />
                        {acc.member_count}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {acc.whatsapp_status === "connected" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500 border border-emerald-500/20">
                          <Wifi className="h-3 w-3" />
                          Connected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500 border border-amber-500/20">
                          <WifiOff className="h-3 w-3" />
                          Disconnected
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {acc.created_at
                        ? format(new Date(acc.created_at), "MMM d, yyyy")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-[11px] text-muted-foreground italic">
                        Phase 3/4 Provisioning
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
