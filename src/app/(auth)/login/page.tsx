"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Lock, Mail, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthDomainNotice } from "@/components/auth/auth-domain-notice";
import { AuthFormCard } from "@/components/auth/auth-form-card";
import { AuthFormHeader } from "@/components/auth/auth-form-header";
import { AuthIconField } from "@/components/auth/auth-icon-field";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { PublicAuthShell } from "@/components/auth/public-auth-shell";
import { authErrorBox, authLink } from "@/components/public/public-theme";
import { Label } from "@/components/ui/label";

type AuthClient = ReturnType<typeof createClient> & {
  auth: ReturnType<typeof createClient>["auth"] & {
    verifyTwoFactor?: (args: {
      challengeToken: string;
      code: string;
    }) => Promise<{
      data?: { session?: unknown } | null;
      error?: { message?: string; code?: string } | null;
    }>;
    resendTwoFactor?: (args: {
      challengeToken: string;
    }) => Promise<{
      data?: { challengeToken?: string; email?: string } | null;
      error?: { message?: string; code?: string } | null;
    }>;
  };
};

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

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [otpEmail, setOtpEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const router = useRouter();
  const supabase = createClient() as AuthClient;

  const finishLogin = () => {
    if (inviteToken) {
      window.location.assign(`/join/${encodeURIComponent(inviteToken)}`);
    } else {
      window.location.assign("/dashboard");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      const error = result.error;
      const data = result.data as {
        needs2FA?: boolean;
        challengeToken?: string;
        email?: string;
        session?: unknown;
      } | null;

      if (data?.needs2FA && data.challengeToken) {
        setChallengeToken(data.challengeToken);
        setOtpEmail(data.email ?? email.trim().toLowerCase());
        setOtpCode("");
        setLoading(false);
        return;
      }

      if (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: string }).code)
            : "";
        const message =
          typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: string }).message)
            : "Sign in failed";

        if (code === "EMAIL_NOT_VERIFIED") {
          router.push(
            `/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`,
          );
          return;
        }

        setError(message);
        setLoading(false);
        return;
      }

      finishLogin();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setLoading(true);

    try {
      const verify = supabase.auth.verifyTwoFactor;
      if (!verify) {
        setError("Two-factor verification is unavailable. Please refresh.");
        setLoading(false);
        return;
      }

      const { error } = await verify({
        challengeToken,
        code: otpCode.trim(),
      });

      if (error) {
        setError(error.message || "Invalid verification code");
        setLoading(false);
        return;
      }

      finishLogin();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!challengeToken || resending) return;
    setError(null);
    setResending(true);
    try {
      const resend = supabase.auth.resendTwoFactor;
      if (!resend) {
        setError("Unable to resend code. Please sign in again.");
        return;
      }
      const { data, error } = await resend({ challengeToken });
      if (error) {
        setError(error.message || "Could not resend code");
        return;
      }
      if (data?.challengeToken) {
        setChallengeToken(data.challengeToken);
      }
      if (data?.email) {
        setOtpEmail(data.email);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Could not resend code";
      setError(message);
    } finally {
      setResending(false);
    }
  };

  const backToPassword = () => {
    setChallengeToken(null);
    setOtpEmail(null);
    setOtpCode("");
    setError(null);
  };

  if (challengeToken) {
    return (
      <PublicAuthShell>
        <AuthFormHeader
          badge="Two-factor authentication"
          title="Check your email"
          description={`We sent a 6-digit code to ${otpEmail ?? "your email"}. Enter it below to finish signing in.`}
        />

        <AuthFormCard>
          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-5">
            {error ? <div className={authErrorBox}>{error}</div> : null}

            <AuthIconField
              id="otp"
              label="Verification code"
              type="text"
              placeholder="6-digit code"
              value={otpCode}
              onChange={(e) =>
                setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              required
              icon={ShieldCheck}
              autoComplete="one-time-code"
            />

            <AuthSubmitButton loading={loading} loadingText="Verifying…">
              Verify and sign in
            </AuthSubmitButton>

            <div className="flex flex-col gap-2 text-center text-sm text-slate-600">
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={resending}
                className={`${authLink} disabled:opacity-60`}
              >
                {resending ? "Sending…" : "Resend code"}
              </button>
              <button
                type="button"
                onClick={backToPassword}
                className="text-slate-500 underline-offset-2 hover:underline"
              >
                Back to sign in
              </button>
            </div>
          </form>
        </AuthFormCard>

        <AuthDomainNotice />
      </PublicAuthShell>
    );
  }

  return (
    <PublicAuthShell>
      <AuthFormHeader
        badge="Secure sign in"
        title={inviteToken ? "Sign in to accept" : "Welcome back"}
        description={
          inviteToken
            ? "Sign in to your account and we'll take you to the team invitation."
            : "Sign in to manage WhatsApp conversations, contacts, and your team."
        }
      />

      <AuthFormCard>
        <form onSubmit={handleLogin} className="flex flex-col gap-5">
          {error ? <div className={authErrorBox}>{error}</div> : null}

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

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="password" className="text-sm font-medium text-slate-700">
                Password
              </Label>
              <Link href="/forgot-password" className={`text-xs ${authLink}`}>
                Forgot password?
              </Link>
            </div>
            <AuthIconField
              id="password"
              label=""
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              icon={Lock}
              autoComplete="current-password"
            />
          </div>

          <AuthSubmitButton loading={loading} loadingText="Signing in…">
            Sign in
          </AuthSubmitButton>
        </form>
      </AuthFormCard>

      <p className="mt-6 text-center text-sm text-slate-600 lg:text-left">
        Don&apos;t have an account?{" "}
        <Link
          href={
            inviteToken
              ? `/signup?invite=${encodeURIComponent(inviteToken)}`
              : "/signup"
          }
          className={authLink}
        >
          Create account
        </Link>
      </p>

      <AuthDomainNotice />
    </PublicAuthShell>
  );
}
