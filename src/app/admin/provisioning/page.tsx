"use client";

import { useEffect, useState } from "react";
import {
  UserPlus,
  Building2,
  PhoneCall,
  Loader2,
  Check,
  KeyRound,
  Shield,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

interface AccountItem {
  id: string;
  name: string;
}

export default function AdminProvisioningPage() {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<AccountItem[]>([]);

  // 1. Create Business Account state
  const [accName, setAccName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);

  // 2. WhatsApp Setup state
  const [waAccountId, setWaAccountId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [displayPhone, setDisplayPhone] = useState("");
  const [savingWhatsApp, setSavingWhatsApp] = useState(false);

  // 3. Create Team User state
  const [userAccountId, setUserAccountId] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userFullName, setUserFullName] = useState("");
  const [userRole, setUserRole] = useState("agent");
  const [creatingUser, setCreatingUser] = useState(false);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/accounts");
      if (res.ok) {
        const data = await res.json();
        const accs = data.accounts ?? [];
        setAccounts(accs);
        if (accs.length > 0) {
          if (!waAccountId) setWaAccountId(accs[0].id);
          if (!userAccountId) setUserAccountId(accs[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load accounts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName || !adminEmail || !adminPassword) return;

    setCreatingAccount(true);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: accName,
          business_admin_email: adminEmail,
          business_admin_password: adminPassword,
          full_name: adminFullName,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create business account");
      }

      toast.success(`Business account "${accName}" created successfully!`);
      setAccName("");
      setAdminEmail("");
      setAdminPassword("");
      setAdminFullName("");
      fetchAccounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error creating account");
    } finally {
      setCreatingAccount(false);
    }
  };

  const handleSetupWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waAccountId || !phoneNumberId || !accessToken) return;

    setSavingWhatsApp(true);
    try {
      const res = await fetch(`/api/admin/accounts/${waAccountId}/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number_id: phoneNumberId,
          waba_id: wabaId,
          access_token: accessToken,
          verify_token: verifyToken,
          display_phone_number: displayPhone,
          status: "connected",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save WhatsApp config");
      }

      toast.success("WhatsApp Meta credentials configured successfully");
      setPhoneNumberId("");
      setWabaId("");
      setAccessToken("");
      setVerifyToken("");
      setDisplayPhone("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error saving WhatsApp setup");
    } finally {
      setSavingWhatsApp(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userAccountId || !userEmail || !userPassword) return;

    setCreatingUser(true);
    try {
      const res = await fetch(`/api/admin/accounts/${userAccountId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          password: userPassword,
          full_name: userFullName,
          role: userRole,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create user");
      }

      toast.success(`User ${userEmail} created and attached to account`);
      setUserEmail("");
      setUserPassword("");
      setUserFullName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error creating user");
    } finally {
      setCreatingUser(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Account & User Provisioning
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">
          Platform-admin provisioning tools: create business accounts, configure WhatsApp credentials, and provision team users.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 1. Create Business Account */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Building2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">1. Create Business Account</h2>
          </div>

          <form onSubmit={handleCreateAccount} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Business Name</label>
              <Input
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="text-xs sm:text-sm"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Admin Email</label>
              <Input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@acme.com"
                className="text-xs sm:text-sm"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Initial Password</label>
              <Input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="••••••••"
                className="text-xs sm:text-sm"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Admin Full Name</label>
              <Input
                value={adminFullName}
                onChange={(e) => setAdminFullName(e.target.value)}
                placeholder="Jane Doe"
                className="text-xs sm:text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={creatingAccount}
              className="inline-flex items-center justify-center gap-2 w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {creatingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
              Create Account
            </button>
          </form>
        </div>

        {/* 2. Configure WhatsApp */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <PhoneCall className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-foreground">2. WhatsApp Credentials</h2>
          </div>

          <form onSubmit={handleSetupWhatsApp} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Target Account</label>
              <select
                value={waAccountId}
                onChange={(e) => setWaAccountId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.id.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Phone Number ID</label>
              <Input
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="Meta Phone Number ID"
                className="text-xs font-mono"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">WABA ID</label>
              <Input
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                placeholder="WhatsApp Business Account ID"
                className="text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">System User Access Token</label>
              <Input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="EAAG..."
                className="text-xs font-mono"
                required
              />
            </div>

            <button
              type="submit"
              disabled={savingWhatsApp || !waAccountId}
              className="inline-flex items-center justify-center gap-2 w-full rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {savingWhatsApp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save WhatsApp Config
            </button>
          </form>
        </div>

        {/* 3. Add Team User */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <UserPlus className="h-4 w-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-foreground">3. Provision Team User</h2>
          </div>

          <form onSubmit={handleCreateUser} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Target Account</label>
              <select
                value={userAccountId}
                onChange={(e) => setUserAccountId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.id.slice(0, 8)}...)
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">User Email</label>
              <Input
                type="email"
                value={userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="agent@acme.com"
                className="text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Password</label>
              <Input
                type="password"
                value={userPassword}
                onChange={(e) => setUserPassword(e.target.value)}
                placeholder="••••••••"
                className="text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Role</label>
              <select
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="admin">Admin (Business Manager)</option>
                <option value="agent">Agent (Operator)</option>
                <option value="viewer">Viewer (Read-only)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={creatingUser || !userAccountId}
              className="inline-flex items-center justify-center gap-2 w-full rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {creatingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Provision User
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
