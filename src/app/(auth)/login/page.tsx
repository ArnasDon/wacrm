"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell, AUTH_INPUT_CLASS, AUTH_BUTTON_CLASS } from "@/components/auth/auth-shell";
import { MessageSquare, UsersRound } from "lucide-react";

// `useSearchParams` opts the component out of static prerendering
// unless it sits under a Suspense boundary. We split the form into
// a child component so the outer page can prerender the chrome
// (background, glow) while the form hydrates with the query string
// on the client.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  // Forwarded from `/join/<token>` when the visitor already has an
  // account. After a successful sign-in we send them to the join
  // page to accept rather than to /dashboard.
  const inviteToken = searchParams.get("invite");
  const t = useTranslations("LoginPage");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
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

    if (inviteToken) {
      router.push(`/join/${encodeURIComponent(inviteToken)}`);
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <AuthShell
      icon={inviteToken ? <UsersRound className="h-6 w-6" /> : <MessageSquare className="h-6 w-6" />}
      title={inviteToken ? t("titleAccept") : t("titleWelcome")}
      description={inviteToken ? t("descAccept") : t("descWelcome")}
      footer={
        <p>
          {t("noAccount")}{" "}
          <Link href={inviteToken ? `/signup?invite=${encodeURIComponent(inviteToken)}` : "/signup"}>
            {t("createAccount")}
          </Link>
        </p>
      }
    >
      <form onSubmit={handleLogin} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-muted-foreground">
            {t("emailLabel")}
          </Label>
          <Input
            id="email"
            type="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-muted-foreground">
              {t("passwordLabel")}
            </Label>
            <Link href="/forgot-password" className="text-sm text-primary underline-offset-2 hover:underline">
              {t("forgotPassword")}
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            placeholder={t("passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={AUTH_INPUT_CLASS}
          />
        </div>

        <Button type="submit" disabled={loading} className={`mt-2 ${AUTH_BUTTON_CLASS}`}>
          {loading ? t("signingIn") : t("signIn")}
        </Button>
      </form>
    </AuthShell>
  );
}
