"use client";

import { WhatsAppOverview } from "@/components/whatsapp/whatsapp-overview";

export default function WhatsAppPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">WhatsApp</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your Business account and manage Meta-approved message
          templates.
        </p>
      </div>
      <WhatsAppOverview />
    </div>
  );
}
