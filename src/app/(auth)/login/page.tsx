"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
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
import { Mail, Lock, Eye, EyeOff, UsersRound, ArrowRight } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("LoginPage");
  const linkError = searchParams.get("error");
  const linkErrorMessage =
    linkError === "link_expired"
      ? t("linkExpired")
      : linkError === "link_invalid"
        ? t("linkInvalid")
        : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const destination = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : "/dashboard";
    window.location.href = destination;
  };

  return (
    <Card className="w-full border-border/80 shadow-2xl bg-card/95 backdrop-blur-xl rounded-2xl overflow-hidden">
      <CardHeader className="items-center text-center pb-4 pt-6">
        {/* Brand Emblem */}
        <div className="relative mb-3 flex size-16 items-center justify-center rounded-2xl bg-white p-2 shadow-lg shadow-cyan-500/10 ring-2 ring-cyan-500/20">
          <Image
            src="/flyorder-logo.png"
            alt="Fly Order Logo"
            width={52}
            height={52}
            priority
            className="size-full object-contain"
          />
        </div>

        <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
          {inviteToken ? t("titleAccept") : "Welcome back"}
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground mt-1">
          {inviteToken
            ? t("descAccept")
            : "Sign in to your Fly Order CRM workspace"}
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-2">
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          {linkErrorMessage && !error && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
              {linkErrorMessage}
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Email field */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email" className="text-xs font-medium text-foreground/80">
              {t("emailLabel")}
            </Label>
            <div className="relative flex items-center">
              <Mail className="absolute left-3 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="email"
                type="email"
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="pl-9 h-11 border-border/80 bg-muted/50 text-foreground placeholder:text-muted-foreground/60 rounded-xl focus-visible:border-cyan-500 focus-visible:ring-cyan-500/20"
              />
            </div>
          </div>

          {/* Password field */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-xs font-medium text-foreground/80">
                {t("passwordLabel")}
              </Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline"
              >
                {t("forgotPassword")}
              </Link>
            </div>
            <div className="relative flex items-center">
              <Lock className="absolute left-3 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="pl-9 pr-10 h-11 border-border/80 bg-muted/50 text-foreground placeholder:text-muted-foreground/60 rounded-xl focus-visible:border-cyan-500 focus-visible:ring-cyan-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>

          {/* Submit button */}
          <Button
            type="submit"
            disabled={loading}
            className="mt-2 h-11 w-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 hover:opacity-95 text-white font-semibold rounded-xl shadow-lg shadow-cyan-500/20 active:scale-[0.99] transition-all disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {t("signingIn")}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {t("signIn")}
                <ArrowRight className="size-4" />
              </span>
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {t("noAccount")}{" "}
          <Link
            href={
              inviteToken
                ? `/signup?invite=${encodeURIComponent(inviteToken)}`
                : "/signup"
            }
            className="font-semibold text-cyan-600 dark:text-cyan-400 hover:underline"
          >
            {t("createAccount")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
