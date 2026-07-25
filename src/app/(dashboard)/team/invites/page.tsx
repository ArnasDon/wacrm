"use client";

import { MembersTab } from "@/components/settings/members-tab";

export default function TeamInvitesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Invitations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create shareable invite links and revoke pending invitations.
        </p>
      </div>
      <MembersTab section="invites" />
    </div>
  );
}
