"use client";

import { useState } from "react";
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
import { Mail, CheckCircle, ArrowLeft, ArrowRight } from "lucide-react";

export default function ForgotPasswordPage() {
  const t = useTranslations("ForgotPasswordPage");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const supabase = createClient();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
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
        <CardHeader className="items-center text-center pb-4 pt-6">
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
        </CardHeader>
        <CardContent className="pt-2">
          <Link href="/login">
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
          {t("title")}
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground mt-1">
          {t("desc")}
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-2">
        <form onSubmit={handleReset} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
              {error}
            </div>
          )}

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

          <Button
            type="submit"
            disabled={loading}
            className="mt-2 h-11 w-full bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 hover:opacity-95 text-white font-semibold rounded-xl shadow-lg shadow-cyan-500/20 active:scale-[0.99] transition-all disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {t("sending")}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {t("sendLink")}
                <ArrowRight className="size-4" />
              </span>
            )}
          </Button>
        </form>

        <Link
          href="/login"
          className="mt-6 flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          {t("backToSignIn")}
        </Link>
      </CardContent>
    </Card>
  );
}
