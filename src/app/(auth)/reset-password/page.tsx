"use client";

import { PasswordInput } from "@/components/ui/password-input";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound } from "lucide-react";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}

function ResetInner() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("Passwords do not match");
    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    }).catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      return setError(body?.error ?? "Could not reset the password");
    }
    setDone(true);
  };

  const cls = "border-slate-700 bg-slate-800 text-white placeholder:text-slate-500 focus-visible:border-primary focus-visible:ring-primary/20";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <Card className="w-full max-w-md border-slate-800 bg-slate-900">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-white">{done ? "Password updated" : "Choose a new password"}</CardTitle>
          <CardDescription className="text-slate-400">
            {done ? "You can now sign in with your new password." : "You'll be signed out of all other devices."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <Link href="/login"><Button className="w-full">Go to sign in</Button></Link>
          ) : !token ? (
            <p className="text-center text-sm text-slate-400">This link is missing its token. Request a new one from <Link href="/forgot-password" className="text-primary">Forgot password</Link>.</p>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
              <div className="flex flex-col gap-2">
                <Label htmlFor="pw" className="text-slate-300">New password</Label>
                <PasswordInput id="pw" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className={cls} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="pw2" className="text-slate-300">Confirm password</Label>
                <PasswordInput id="pw2" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className={cls} />
              </div>
              <Button type="submit" disabled={loading} className="h-10">{loading ? "Saving…" : "Set new password"}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
