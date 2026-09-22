"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { NOME_DO_APP } from "@/lib/marca";
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
import { MessageSquare, CheckCircle, Lock, UsersRound } from "lucide-react";

// `useSearchParams` opts the component out of static prerendering
// unless wrapped in Suspense — same pattern as /login.
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const t = useTranslations("SignupPage");
  const searchParams = useSearchParams();
  // When the user lands here from `/join/<token>` we carry the
  // invite token in the query. With it, the account is created AND the
  // invitation accepted by the SERVER (`/api/invitations/<token>/cadastro`)
  // — so a new teammate still gets in with the public signup CLOSED in
  // Supabase, and lands directly in the team. Without it, this is the
  // plain public signup, which is refused once it is closed.
  const inviteToken = searchParams.get("invite");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // O cadastro público está fechado no Supabase? `null` = não sei (ainda
  // não respondeu, ou a consulta falhou): aí o formulário aparece, e a
  // recusa do envio é traduzida do mesmo jeito. Só com convite a pergunta
  // não importa — por ele a conta nasce no servidor.
  const [cadastroFechado, setCadastroFechado] = useState<boolean | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (inviteToken) return;
    let cancelado = false;
    // `/auth/v1/settings` é público (só a chave anon) e diz, entre outras
    // coisas, se novos cadastros estão desligados. Sem isto, quem chega sem
    // convite preenchia os quatro campos para só então ser recusado.
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((config: { disable_signup?: unknown } | null) => {
        if (!cancelado && config) {
          setCadastroFechado(config.disable_signup === true);
        }
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [inviteToken]);

  // A conta nasce no servidor, já confirmada e já DENTRO da equipe (a rota
  // aceita o convite na mesma requisição). Aqui só se adota a sessão que
  // ela devolve. Devolve para ONDE seguir, ou `null` quando parou com erro
  // na tela: `/dashboard` com o aceite confirmado; `/join/<token>` quando o
  // servidor não conseguiu saber se o convite foi aceito — lá o botão
  // "Aceitar" aparece se ele ainda estiver pendente.
  const cadastrarPorConvite = async (token: string): Promise<string | null> => {
    let res: Response;
    try {
      res = await fetch(
        `/api/invitations/${encodeURIComponent(token)}/cadastro`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nome: fullName, email, senha: password }),
        },
      );
    } catch {
      setError(t("signupFailed"));
      setLoading(false);
      return null;
    }

    const corpo = (await res.json().catch(() => null)) as {
      codigo?: string;
      sessao?: { access_token?: unknown; refresh_token?: unknown };
    } | null;
    const incerto = res.status === 503 && corpo?.codigo === "aceite_incerto";
    if (!res.ok && !incerto) {
      setError(mensagemDoCadastro(res.status, corpo?.codigo));
      setLoading(false);
      return null;
    }

    const access = corpo?.sessao?.access_token;
    const refresh = corpo?.sessao?.refresh_token;
    const { error: erroAoEntrar } =
      typeof access === "string" && typeof refresh === "string"
        ? await supabase.auth.setSession({
            access_token: access,
            refresh_token: refresh,
          })
        : { error: new Error("sem sessão") };
    if (erroAoEntrar) {
      setError(t("signedUpButSignInFailed"));
      setLoading(false);
      return null;
    }
    return incerto ? `/join/${encodeURIComponent(token)}` : "/dashboard";
  };

  const mensagemDoCadastro = (status: number, codigo?: string): string => {
    if (status === 429) return t("tooManyAttempts");
    switch (codigo) {
      case "convite_invalido":
        return t("inviteInvalid");
      case "email_existe":
        return t("emailExists");
      case "senha_fraca":
        return t("weakPassword");
      case "dados_invalidos":
        return t("invalidData");
      default:
        return t("signupFailed");
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      return;
    }

    if (password.length < 6) {
      setError(t("passwordTooShort"));
      return;
    }

    // O bcrypt do Supabase conta BYTES: letra com acento vale dois.
    if (new TextEncoder().encode(password).length > 72) {
      setError(t("passwordTooLong"));
      return;
    }

    setLoading(true);

    if (inviteToken) {
      // Navegação completa, pelo mesmo motivo do ramo sem convite, abaixo:
      // o middleware e o AuthProvider só leem a sessão (e a conta nova)
      // numa requisição nova. O botão continua desabilitado enquanto o
      // navegador troca de página.
      const destino = await cadastrarPorConvite(inviteToken);
      if (destino) window.location.href = destino;
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) {
      // Cadastro público fechado no Supabase: a mensagem crua é
      // "Signups not allowed for this instance", em inglês e sem dizer
      // o que fazer.
      setError(
        error.code === "signup_disabled" ? t("signupClosed") : error.message,
      );
      setLoading(false);
      return;
    }

    // Whether a verification email exists at all is a PROJECT setting
    // ("Confirm email" in Supabase Auth), not something this page can
    // assume. The two outcomes are told apart by `data.session`:
    //
    //   session !== null  → confirmation is OFF. The user is already
    //                       signed in, right now. Showing them
    //                       "check your email" strands them waiting
    //                       for a message that is never sent — which
    //                       is exactly what happened to the first
    //                       teammate invited to this account
    //                       (2026-08-30: signed up, auto-confirmed
    //                       17ms later, never redeemed the invite).
    //   session === null  → confirmation is ON. The card below is
    //                       accurate; keep showing it.
    //
    // Hard navigation, not router.push: the session cookies were just
    // written by the Supabase client, and the middleware only reads
    // them on a fresh request. A client-side push can reach /join
    // before the middleware sees the new session and get bounced.
    if (data.session) {
      window.location.href = "/dashboard";
      // Deliberately leave `loading` true: the button stays disabled
      // while the browser navigates, so an impatient second click
      // can't fire a duplicate signUp.
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (!inviteToken && cadastroFechado) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">
              {t("closedTitle")}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t("signupClosed")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login">
              <Button
                variant="outline"
                className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t("backToSignIn")}
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-border bg-card">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">
              {t("checkEmailTitle")}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t.rich("checkEmailDescription", {
                email,
                highlight: (chunks) => (
                  <span className="text-foreground">{chunks}</span>
                ),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : "/login"
              }
            >
              <Button
                variant="outline"
                className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t("backToSignIn")}
              </Button>
            </Link>
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
            {inviteToken ? (
              <UsersRound className="h-6 w-6 text-primary" />
            ) : (
              <MessageSquare className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle className="text-xl text-foreground">
            {inviteToken ? t("titleInvite") : t("title")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {inviteToken
              ? t("descriptionInvite")
              : t("description", { appName: NOME_DO_APP })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName" className="text-muted-foreground">
                {t("fullNameLabel")}
              </Label>
              <Input
                id="fullName"
                type="text"
                placeholder={t("fullNamePlaceholder")}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

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
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-muted-foreground">
                {t("passwordLabel")}
              </Label>
              <Input
                id="password"
                type="password"
                placeholder={t("passwordPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPassword" className="text-muted-foreground">
                {t("confirmPasswordLabel")}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t("confirmPasswordPlaceholder")}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t("creatingAccount") : t("createAccountButton")}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("alreadyHaveAccount")}{" "}
            <Link
              href={
                inviteToken
                  ? `/login?invite=${encodeURIComponent(inviteToken)}`
                  : "/login"
              }
              className="text-primary hover:text-primary/80"
            >
              {t("signIn")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
