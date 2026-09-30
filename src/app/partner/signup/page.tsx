"use client";

// ============================================================
// /partner/signup?token=… — complete a Partner invitation.
//
// Validates the token with the backend first; the form only renders
// for a live invitation. Company / email / phone come from the
// invitation and are read-only. On success the SubUser signs in on
// the regular /login page — there is no separate partner login.
// ============================================================

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle, Clock, Handshake, Loader2, ShieldX, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_PASSWORD_LEN,
  MAX_PERSON_NAME_LEN,
  validatePartnerSignup,
  type PartnerSignupInput,
} from "@/lib/partners/validation";

type InvitationInfo = {
  companyName: string;
  email: string;
  phone: string;
  expiresAt: string;
  inviterName: string;
};

type PageState =
  | { kind: "loading" }
  | { kind: "valid"; invitation: InvitationInfo }
  | { kind: "success"; email: string }
  | { kind: "expired" | "used" | "revoked" | "account_exists" | "invalid" | "error" };

type Field = keyof PartnerSignupInput;

export default function PartnerSignupPage() {
  return (
    <Suspense fallback={null}>
      <PartnerSignupInner />
    </Suspense>
  );
}

const INPUT_CLASS =
  "border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20 aria-invalid:border-destructive";

function PartnerSignupInner() {
  const t = useTranslations("PartnerSignup");
  const tErr = useTranslations("Partners.errors");
  const token = useSearchParams().get("token") ?? "";

  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [values, setValues] = useState({ firstName: "", lastName: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/partner-invitations/validate?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const payload = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (payload.state === "valid") setState({ kind: "valid", invitation: payload.invitation });
        else if (["expired", "used", "revoked", "account_exists", "invalid"].includes(payload.state))
          setState({ kind: payload.state });
        else setState({ kind: "error" });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function update(field: Field, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const parsed = validatePartnerSignup(values);
    if (!parsed.ok) {
      const next: Partial<Record<Field, string>> = {};
      for (const [field, code] of Object.entries(parsed.errors)) {
        next[field as Field] = tErr(code as string);
      }
      setErrors(next);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/partner-invitations/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...parsed.value }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        setState({ kind: "success", email: payload.email });
        return;
      }
      if (["expired", "used", "revoked", "account_exists", "invalid"].includes(payload.state)) {
        setState({ kind: payload.state });
        return;
      }
      setFormError(payload.error || t("failed"));
    } catch {
      setFormError(t("networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (state.kind === "loading") {
    return <Loader2 className="size-6 animate-spin text-muted-foreground" />;
  }

  if (state.kind === "success") {
    return (
      <StatusCard icon={CheckCircle} tone="success" title={t("success.title")} desc={t("success.desc")}>
        <Link href="/login" className="w-full">
          <Button className="h-10 w-full">{t("success.signIn")}</Button>
        </Link>
      </StatusCard>
    );
  }

  if (state.kind !== "valid") {
    const meta = {
      expired: { icon: Clock, key: "expired" },
      used: { icon: UserCheck, key: "used" },
      revoked: { icon: ShieldX, key: "revoked" },
      account_exists: { icon: UserCheck, key: "accountExists" },
      invalid: { icon: ShieldX, key: "invalid" },
      error: { icon: ShieldX, key: "error" },
    }[state.kind];
    return (
      <StatusCard icon={meta.icon} tone="muted" title={t(`${meta.key}.title`)} desc={t(`${meta.key}.desc`)}>
        <Link href="/login" className="w-full">
          <Button variant="outline" className="h-10 w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground">
            {t("goToSignIn")}
          </Button>
        </Link>
      </StatusCard>
    );
  }

  const { invitation } = state;

  return (
    <Card className="w-full max-w-md border-border bg-card">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Handshake className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-xl text-foreground">{t("title")}</CardTitle>
        <CardDescription className="text-muted-foreground">
          {t("desc", { inviter: invitation.inviterName })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {formError}
            </div>
          )}

          {(
            [
              ["companyName", invitation.companyName],
              ["email", invitation.email],
              ["phone", invitation.phone],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="flex flex-col gap-2">
              <Label htmlFor={`ps-${key}`} className="text-muted-foreground">
                {t(`${key}Label`)}
              </Label>
              <Input id={`ps-${key}`} value={value} readOnly aria-readonly className={`${INPUT_CLASS} cursor-default opacity-80`} />
            </div>
          ))}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(["firstName", "lastName"] as const).map((field) => (
              <FieldInput
                key={field}
                id={`ps-${field}`}
                label={t(`${field}Label`)}
                autoComplete={field === "firstName" ? "given-name" : "family-name"}
                maxLength={MAX_PERSON_NAME_LEN}
                value={values[field]}
                error={errors[field]}
                onChange={(v) => update(field, v)}
              />
            ))}
          </div>

          <FieldInput
            id="ps-password"
            type="password"
            label={t("passwordLabel")}
            placeholder={t("passwordPlaceholder")}
            autoComplete="new-password"
            maxLength={MAX_PASSWORD_LEN}
            value={values.password}
            error={errors.password}
            onChange={(v) => update("password", v)}
          />
          <FieldInput
            id="ps-confirmPassword"
            type="password"
            label={t("confirmPasswordLabel")}
            autoComplete="new-password"
            maxLength={MAX_PASSWORD_LEN}
            value={values.confirmPassword}
            error={errors.confirmPassword}
            onChange={(v) => update("confirmPassword", v)}
          />

          <Button type="submit" disabled={submitting} className="mt-2 h-10 w-full">
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("creating")}
              </>
            ) : (
              t("submit")
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function FieldInput(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.id} className="text-muted-foreground">
        {props.label}
      </Label>
      <Input
        id={props.id}
        type={props.type ?? "text"}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        maxLength={props.maxLength}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={!!props.error}
        aria-describedby={props.error ? `${props.id}-error` : undefined}
        required
        className={INPUT_CLASS}
      />
      {props.error ? (
        <p id={`${props.id}-error`} className="text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

function StatusCard(props: {
  icon: typeof CheckCircle;
  tone: "success" | "muted";
  title: string;
  desc: string;
  children?: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <Card className="w-full max-w-md border-border bg-card">
      <CardHeader className="items-center text-center">
        <div
          className={`mb-2 flex h-12 w-12 items-center justify-center rounded-xl ${
            props.tone === "success" ? "bg-primary/10" : "bg-muted"
          }`}
        >
          <Icon className={`h-6 w-6 ${props.tone === "success" ? "text-primary" : "text-muted-foreground"}`} />
        </div>
        <CardTitle className="text-xl text-foreground">{props.title}</CardTitle>
        <CardDescription className="text-muted-foreground">{props.desc}</CardDescription>
      </CardHeader>
      {props.children ? <CardContent>{props.children}</CardContent> : null}
    </Card>
  );
}
