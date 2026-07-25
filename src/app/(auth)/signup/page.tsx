"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail, Phone, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthDomainNotice } from "@/components/auth/auth-domain-notice";
import { AuthFormCard } from "@/components/auth/auth-form-card";
import { AuthFormHeader } from "@/components/auth/auth-form-header";
import { AuthIconField } from "@/components/auth/auth-icon-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { AuthTrustBadges } from "@/components/auth/auth-trust-badges";
import { PublicAuthShell } from "@/components/auth/public-auth-shell";
import { authErrorBox, authLink } from "@/components/public/public-theme";
import { PRODUCT_NAME } from "@/lib/brand";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobileNo, setMobileNo] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    if (!mobileNo.trim()) {
      setError("Mobile number is required");
      return;
    }

    setLoading(true);

    try {
      const result = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            mobile_no: mobileNo.trim(),
            invite_token: inviteToken,
          },
        },
      });

      const { error } = result;
      const needsVerification = Boolean(
        (result.data as { needsVerification?: boolean } | null)?.needsVerification,
      );

      if (error) {
        if (needsVerification) {
          router.push(
            `/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`,
          );
          return;
        }

        setError(error.message);
        setLoading(false);
        return;
      }

      if (needsVerification) {
        router.push(
          `/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`,
        );
        return;
      }

      if (inviteToken) {
        router.push(`/join/${encodeURIComponent(inviteToken)}`);
      } else {
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
      setLoading(false);
    }
  };

  const passwordToggle = (visible: boolean, toggle: () => void) => (
    <button
      type="button"
      onClick={toggle}
      className="rounded-lg p-2 text-slate-400 transition-colors hover:text-slate-600"
      aria-label={visible ? "Hide password" : "Show password"}
    >
      {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );

  return (
    <PublicAuthShell>
      <AuthFormHeader
        badge="Free to start"
        title={inviteToken ? "Join your team" : "Create your account"}
        description={
          inviteToken
            ? "Create your account to accept the team invitation and start collaborating."
            : `Get started with ${PRODUCT_NAME} — shared inbox, contacts, and automations for your business.`
        }
      />

      <AuthFormCard>
        <form onSubmit={handleSignup} className="flex flex-col gap-5">
          {error ? <div className={authErrorBox}>{error}</div> : null}

          <AuthIconField
            id="fullName"
            label="Full name"
            type="text"
            placeholder="Your full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            icon={User}
            autoComplete="name"
          />

          <AuthIconField
            id="email"
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            icon={Mail}
            autoComplete="email"
          />

          <AuthIconField
            id="mobileNo"
            label="Mobile number"
            type="tel"
            placeholder="+91 98765 43210"
            value={mobileNo}
            onChange={(e) => setMobileNo(e.target.value)}
            required
            icon={Phone}
            autoComplete="tel"
          />

          <AuthIconField
            id="password"
            label="Password"
            type={showPassword ? "text" : "password"}
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            icon={Lock}
            autoComplete="new-password"
            suffix={passwordToggle(showPassword, () => setShowPassword((v) => !v))}
          />

          <AuthIconField
            id="confirmPassword"
            label="Confirm password"
            type={showConfirmPassword ? "text" : "password"}
            placeholder="Repeat your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            icon={Lock}
            autoComplete="new-password"
            suffix={passwordToggle(showConfirmPassword, () =>
              setShowConfirmPassword((v) => !v),
            )}
          />

          <AuthSubmitButton loading={loading} loadingText="Creating account…">
            Create account
          </AuthSubmitButton>
        </form>
      </AuthFormCard>

      <AuthTrustBadges />

      <p className="mt-6 text-center text-sm text-slate-600 lg:text-left">
        Already have an account?{" "}
        <Link
          href={
            inviteToken
              ? `/login?invite=${encodeURIComponent(inviteToken)}`
              : "/login"
          }
          className={authLink}
        >
          Sign in
        </Link>
      </p>

      <AuthDomainNotice />
    </PublicAuthShell>
  );
}
