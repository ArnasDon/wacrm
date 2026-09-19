"use client";

import { PasswordInput } from "@/components/ui/password-input";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Monitor } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Field, Panel, inputCls, timeAgo } from "@/components/sales/kit";

interface Session { id: string; current: boolean; userAgent: string | null; ip: string | null; lastSeenAt: string }

function device(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

export function ProfileSettings() {
  const { profile, refreshProfile } = useAuth();
  // null = untouched → show the saved name; a string = being edited.
  const [draftName, setDraftName] = useState<string | null>(null);
  const fullName = draftName ?? profile?.full_name ?? "";
  const setFullName = setDraftName;
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [sessions, setSessions] = useState<Session[]>([]);

  const loadSessions = () => api<{ sessions: Session[] }>("/api/auth/sessions").then((d) => setSessions(d.sessions)).catch(() => {});
  useEffect(() => {
    void loadSessions();
  }, []);

  const saveName = async () => {
    try {
      await api("/api/auth/me", { method: "PATCH", body: { fullName } });
      await refreshProfile();
      setDraftName(null);
      toast.success("Saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const changePassword = async () => {
    if (pw.next !== pw.confirm) return toast.error("New passwords don't match");
    try {
      await api("/api/auth/password", { body: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: "", next: "", confirm: "" });
      toast.success("Password changed — other devices were signed out");
      void loadSessions();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Your profile">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
          <Field label="Email"><input className={inputCls} value={profile?.email ?? ""} disabled /></Field>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={saveName}>Save</Button></div>
      </Panel>
      <Panel title="Change password">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Current password"><PasswordInput className={inputCls} value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} /></Field>
          <Field label="New password" hint="At least 8 characters"><PasswordInput className={inputCls} value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} /></Field>
          <Field label="Confirm new password"><PasswordInput className={inputCls} value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} /></Field>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={changePassword} disabled={!pw.current || pw.next.length < 8}>Change password</Button></div>
      </Panel>
      <Panel
        title="Signed-in devices"
        actions={sessions.length > 1 ? (
          <Button size="sm" variant="ghost" className="text-red-300" onClick={() => api("/api/auth/sessions", { method: "DELETE" }).then(() => { toast.success("Other devices signed out"); void loadSessions(); })}>
            Sign out other devices
          </Button>
        ) : null}
      >
        <ul className="divide-y divide-slate-800">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
              <Monitor className="size-4 text-slate-500" />
              <span className="flex-1 text-slate-200">{device(s.userAgent)}{s.current ? <span className="ml-2 text-xs text-emerald-300">this device</span> : null}</span>
              <span className="text-xs text-slate-500">{timeAgo(s.lastSeenAt)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
