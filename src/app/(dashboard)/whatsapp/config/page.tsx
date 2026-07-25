"use client";

import { WhatsAppConfig } from "@/components/settings/whatsapp-config";

export default function WhatsAppConfigPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          WhatsApp connection
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your WhatsApp Business API credentials and registration.
        </p>
      </div>
      <WhatsAppConfig />
    </div>
  );
}
