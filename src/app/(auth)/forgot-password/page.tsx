"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { MessageSquare, ArrowLeft } from "lucide-react";

// Two-step flow: request a code, then verify it.
//
// The reset email also contains a clickable link (kept as a fallback via
// /auth/callback), but that link is a *single-use* token — and in
// practice, corporate/webmail security scanners "click" every link in an
// inbound email to check for phishing before the user ever sees it. That
// silently burns the link and leaves the user stuck on "invalid or
// expired" with no way to tell why. Confirmed live: recovery_sent_at and
// last_sign_in_at were 42 seconds apart on a real account — far too fast
// to be a human reading the email, clicking through.
//
// The code sent in the same email sidesteps that entirely: a
// scanner has nothing to click, and the code is only useful if the human
// who received the email types it in themselves.
//
// Length is this Supabase project's actual configured OTP length —
// confirmed live via the admin API (`email_otp` came back 8 digits, not
// the commonly-assumed default of 6). Auth -> Emails -> OTP length in
// the dashboard is the source of truth if this project's setting ever
// changes.
const CODE_LENGTH = 8;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStep("verify");
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "recovery",
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/reset-password");
  };

  if (step === "verify") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <MessageSquare className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">
              Enter your code
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              We sent a {CODE_LENGTH}-digit code to{" "}
              <span className="text-foreground">{email}</span>. It also
              contains a reset link, but the code is more reliable — some
              email providers auto-open links before you see them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerify} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="code" className="text-muted-foreground">
                  {CODE_LENGTH}-digit code
                </Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={"1".repeat(CODE_LENGTH)}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  maxLength={CODE_LENGTH}
                  className="border-border bg-muted text-center text-lg tracking-[0.3em] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                />
              </div>

              <Button
                type="submit"
                disabled={loading || code.trim().length < CODE_LENGTH}
                className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? "Verifying..." : "Verify code"}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => setStep("request")}
              className="mt-6 flex w-full items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Use a different email
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">Reset password</CardTitle>
          <CardDescription className="text-muted-foreground">
            Enter your email and we&apos;ll send you a code
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRequest} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send code"}
            </Button>
          </form>

          <Link
            href="/login"
            className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
