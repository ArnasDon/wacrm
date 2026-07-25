"use client";

import { MembersTab } from "@/components/settings/members-tab";

export default function TeamMembersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Roster, roles, and WhatsApp number assignment for your workspace.
        </p>
      </div>
      <MembersTab section="members" />
    </div>
  );
}
