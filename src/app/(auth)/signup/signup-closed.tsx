import Link from "next/link";
import { Lock, MailQuestion, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SignupDenialReason } from "@/lib/auth/signup-gate";

// ============================================================
// What /signup renders when SIGNUP_MODE won't let this visitor
// register.
//
// A blank redirect to /login would leave the visitor guessing
// whether they mistyped the URL, whether the app is broken, or
// whether they were deliberately turned away — so each denial
// reason gets copy that names the situation and points at the one
// action that can actually resolve it.
//
// Deliberately vague about *which* mode is set: "the operator
// closed registrations" and "your invite link is stale" are the
// facts a visitor needs, and neither requires publishing this
// deployment's configuration to anonymous traffic.
// ============================================================

const COPY: Record<
  SignupDenialReason,
  { icon: typeof Lock; title: string; body: string }
> = {
  disabled: {
    icon: ShieldOff,
    title: "Sign-ups are closed",
    body: "This workspace isn't accepting new registrations. If you're joining a team, ask an admin to create your account for you.",
  },
  invite_required: {
    icon: Lock,
    title: "Invitation required",
    body: "New accounts on this workspace are by invitation only. Ask a team admin to send you an invite link, then open it to finish signing up.",
  },
  invalid_invite: {
    icon: MailQuestion,
    title: "That invitation isn't valid",
    body: "This invite link has expired, has already been used, or we couldn't verify it just now. Ask the person who invited you for a fresh link — they take a few seconds to generate.",
  },
};

export function SignupClosed({
  reason,
  inviteToken,
}: {
  reason: SignupDenialReason;
  inviteToken: string | null;
}) {
  const copy = COPY[reason];
  const Icon = copy.icon;

  // Keep carrying the token into /login. Someone who already has a
  // login and follows an invite link ends up here in invite_only
  // mode; sending them to a sign-in that forgets the invite would
  // strand them one step short of joining.
  const loginHref = inviteToken
    ? `/login?invite=${encodeURIComponent(inviteToken)}`
    : "/login";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <Icon className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl text-foreground">
            {copy.title}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {copy.body}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={loginHref}>
            <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              Sign in instead
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
