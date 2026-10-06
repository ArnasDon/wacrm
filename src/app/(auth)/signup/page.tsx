"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  CheckCircle,
  Clock,
  ArrowRight,
} from "lucide-react";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("SignupPage");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("passwordsMismatch"));
      return;
    }

    if (password.length < 6) {
      setError(t("passwordTooShort"));
      return;
    }

    setLoading(true);

    const next = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : "/dashboard";
    const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
        emailRedirectTo,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <Card className="w-full border-border/80 shadow-2xl bg-card/95 backdrop-blur-xl rounded-2xl overflow-hidden">
        <CardHeader className="flex flex-col items-center justify-center text-center pb-4 pt-6">
          <div className="relative mb-3 mx-auto justify-self-center flex size-16 items-center justify-center rounded-2xl bg-white p-2 shadow-lg shadow-cyan-500/10 ring-2 ring-cyan-500/20">
            <Image
              src="/flyorder-logo.png"
              alt="Fly Order Logo"
              width={52}
              height={52}
              priority
              className="size-full object-contain"
            />
          </div>

          {inviteToken ? (
            <>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                <CheckCircle className="size-5" />
              </div>
              <CardTitle className="text-xl font-bold text-foreground">
                {t("checkEmailTitle")}
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground mt-2">
                {t.rich("checkEmailDesc", {
                  email,
                  strong: (chunks) => (
                    <span className="text-foreground font-semibold">{chunks}</span>
                  ),
                })}
              </CardDescription>
            </>
          ) : (
            <>
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                <Clock className="size-5" />
              </div>
              <CardTitle className="text-xl font-bold text-foreground">
                Registration Submitted
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Thank you for registering (<span className="text-foreground font-semibold">{email}</span>). Your account is currently{" "}
                <strong className="text-amber-500">pending administrator approval</strong>. Once an administrator approves your request, you will receive access to the workspace.
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent className="pt-2">
          <Link
            href={
              inviteToken
                ? `/login?invite=${encodeURIComponent(inviteToken)}`
                : "/login"
            }
          >
            <Button
              variant="outline"
              className="w-full h-11 border-border/80 text-foreground hover:bg-muted rounded-xl"
            >
              {t("backToSignIn")}
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-border/80 shadow-2xl bg-card/95 backdrop-blur-xl rounded-2xl overflow-hidden">
      <CardHeader className="flex flex-col items-center justify-center text-center pb-4 pt-6">
        {/* Brand Emblem */}
        <div className="relative mb-3 mx-auto justify-self-center flex size-16 items-center justify-center rounded-2xl bg-white p-2 shadow-lg shadow-cyan-500/10 ring-2 ring-cyan-500/20">
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
          {inviteToken ? t("titleJoin") : "Join Fly Order Team"}
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground mt-1">
          {inviteToken
            ? t("descJoin")
            : "Create your agent account to access the workspace"}
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-2">
        <form onSubmit={handleSignup} className="flex flex-col gap-3.5">
          {error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Full name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fullName" className="text-xs font-medium text-foreground/80">
              {t("fullNameLabel")}
            </Label>
            <div className="relative flex items-center">
              <User className="absolute left-3 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="fullName"
                type="text"
                placeholder={t("fullNamePlaceholder")}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="pl-9 h-11 border-border/80 bg-muted/50 text-foreground placeholder:text-muted-foreground/60 rounded-xl focus-visible:border-cyan-500 focus-visible:ring-cyan-500/20"
              />
            </div>
          </div>

          {/* Email */}
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

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password" className="text-xs font-medium text-foreground/80">
              {t("passwordLabel")}
            </Label>
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

          {/* Confirm Password */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmPassword" className="text-xs font-medium text-foreground/80">
              {t("confirmPasswordLabel")}
            </Label>
            <div className="relative flex items-center">
              <Lock className="absolute left-3 size-4 text-muted-foreground pointer-events-none" />
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder={t("confirmPasswordPlaceholder")}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="pl-9 pr-10 h-11 border-border/80 bg-muted/50 text-foreground placeholder:text-muted-foreground/60 rounded-xl focus-visible:border-cyan-500 focus-visible:ring-cyan-500/20"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? (
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
                {t("creating")}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {t("submit")}
                <ArrowRight className="size-4" />
              </span>
            )}
          </Button>
        </form>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          {t("haveAccount")}{" "}
          <Link
            href={
              inviteToken
                ? `/login?invite=${encodeURIComponent(inviteToken)}`
                : "/login"
            }
            className="font-semibold text-cyan-600 dark:text-cyan-400 hover:underline"
          >
            {t("signIn")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
