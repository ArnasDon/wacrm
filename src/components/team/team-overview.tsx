"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Mail, UserPlus, Users } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

export function TeamOverview() {
  const { loading: authLoading, canManageMembers } = useAuth();
  const [loading, setLoading] = useState(true);
  const [memberCount, setMemberCount] = useState(0);
  const [inviteCount, setInviteCount] = useState(0);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    (async () => {
      try {
        const [mres, ires] = await Promise.all([
          fetch("/api/account/members", { cache: "no-store" }),
          canManageMembers
            ? fetch("/api/account/invitations", { cache: "no-store" })
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        if (mres.ok) {
          const mdata = (await mres.json()) as { members?: unknown[] };
          setMemberCount(mdata.members?.length ?? 0);
        }

        if (ires?.ok) {
          const idata = (await ires.json()) as { invitations?: unknown[] };
          setInviteCount(idata.invitations?.length ?? 0);
        } else {
          setInviteCount(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, canManageMembers]);

  if (loading || authLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading team…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={Users}
          label="Members"
          value={String(memberCount)}
          href="/team/members"
        />
        <StatCard
          icon={Mail}
          label="Pending invites"
          value={String(inviteCount)}
          href="/team/invites"
        />
        <StatCard
          icon={UserPlus}
          label="Invite"
          value="Add teammate"
          href="/team/invites"
        />
      </div>

      <div className="rounded-2xl border border-dashed border-border bg-card/50 p-6">
        <h2 className="text-base font-semibold text-foreground">
          Manage your workspace team
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Invite agents and admins, assign WhatsApp numbers, and control who
          can see leads. Team seating is available on the Enterprise plan.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/team/members"
            className={cn(buttonVariants({ variant: "default" }), "gap-2")}
          >
            <Users className="size-4" />
            View members
          </Link>
          <Link
            href="/team/invites"
            className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
          >
            <UserPlus className="size-4" />
            Invitations
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="mt-2 text-xl font-semibold text-foreground group-hover:text-primary">
        {value}
      </p>
    </Link>
  );
}
