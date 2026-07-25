"use client";

import { MetaAppSecretPanel } from "@/components/settings/meta-app-secret-panel";

export default function WhatsAppAppSecretPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">App Secret</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Store your Meta App Secret so VedMint can verify WhatsApp webhook
          signatures.
        </p>
      </div>
      <MetaAppSecretPanel />
    </div>
  );
}
