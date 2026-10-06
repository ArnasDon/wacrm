"use client";

// ============================================================
// /reset-password — the form the password-reset email leads to.
//
// The emailed link lands on /auth/callback, which exchanges it for a
// session and 303s here. So on arrival the visitor either has a
// recovery session (show the form) or doesn't (the link was spent,
// expired, or opened in a browser without the PKCE verifier cookie —
// say so, with a way to request a new one). Bouncing to /login with
// no explanation was the locked-out experience issue #592 describes.
//
// Not gated by the middleware on purpose: the "expired" state must be
// reachable signed-out, and a signed-in visitor must not be redirected
// away from the very page they need.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle, Eye, EyeOff, Lock, Loader2, MailX } from "lucide-react";

type Status = "checking" | "ready" | "expired" | "done";

export default function ResetPasswordPage() {
  const t = useTranslations("ResetPasswordPage");
  const supabase = createClient();

  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The callback wrote the session cookies server-side; the browser
    // client reads them here. No user → the link didn't yield a session.
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled) setStatus(user ? "ready" : "expired");
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("passwordsMismatch"));
      return;
    }
    // Same floor as /signup.
    if (password.length < 6) {
      setError(t("passwordTooShort"));
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }
    setStatus("done");
  };

  if (status === "checking") {
    return (
      <Card className="w-full border-border/80 bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/20">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
          <span>{t("checking")}</span>
        </CardContent>
      </Card>
    );
  }

  if (status === "expired") {
    return (
      <Card className="w-full border-border/80 bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/20">
        <CardHeader className="items-center text-center pb-4">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20 shadow-sm">
            <MailX className="h-7 w-7 text-amber-500" />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight text-foreground">
            {t("expiredTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            {t("expiredDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Link href="/forgot-password" className="w-full">
            <Button className="h-11 w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white font-medium shadow-md shadow-emerald-500/20 hover:from-emerald-500 hover:to-cyan-500 transition-all duration-200">
              {t("requestNewLink")}
            </Button>
          </Link>
          <Link href="/login" className="w-full">
            <Button
              variant="outline"
              className="h-10 w-full border-border/70 hover:bg-muted/80 text-foreground font-medium"
            >
              {t("backToSignIn")}
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (status === "done") {
    return (
      <Card className="w-full border-border/80 bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/20">
        <CardHeader className="items-center text-center pb-4">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-sm">
            <CheckCircle className="h-7 w-7 text-emerald-500" />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight text-foreground">
            {t("successTitle")}
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm">
            {t("successDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="h-11 w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white font-medium shadow-md shadow-emerald-500/20 hover:from-emerald-500 hover:to-cyan-500 transition-all duration-200"
            onClick={() => {
              // Full-page navigation, like /login: the middleware
              // gating /dashboard must see the session cookies on a
              // fresh top-level request, which a soft router.push
              // can race (issue #365).
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full reload so the auth cookies reach the middleware
              window.location.href = "/dashboard";
            }}
          >
            {t("continueToDashboard")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-border/80 bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/20">
      <CardHeader className="space-y-2 pb-4 text-center items-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 via-cyan-500/10 to-teal-500/20 border border-emerald-500/30 shadow-inner p-2.5">
          <Image
            src="/flyorder-logo.png"
            alt="FlyOrder Logo"
            width={40}
            height={40}
            className="h-full w-full object-contain"
            priority
          />
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
          {t("title")}
        </CardTitle>
        <CardDescription className="text-muted-foreground text-sm">
          {t("desc")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-500 dark:text-rose-400">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("passwordLabel")}
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 pl-10 pr-10 border-border/70 bg-background/60 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmPassword" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("confirmPasswordLabel")}
            </Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder={t("confirmPasswordPlaceholder")}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="h-11 pl-10 pr-10 border-border/70 bg-background/60 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground transition-colors"
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            disabled={saving}
            className="mt-2 h-11 w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white font-medium shadow-md shadow-emerald-500/20 hover:from-emerald-500 hover:to-cyan-500 transition-all duration-200 disabled:opacity-50"
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("saving")}
              </span>
            ) : (
              t("submit")
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
