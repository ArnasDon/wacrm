"use client";

import { TeamOverview } from "@/components/team/team-overview";

export default function TeamPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Invite teammates, manage roles, and assign WhatsApp numbers.
        </p>
      </div>
      <TeamOverview />
    </div>
  );
}
