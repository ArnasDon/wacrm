"use client";

import { WebhookTabs } from '@/components/webhooks/webhook-tabs';

export default function WebhooksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Webhook Integration</h1>
        <p className="mt-1 text-sm text-slate-400">
          Connect your account with various systems and applications to trigger WhatsApp templates in real time.
        </p>
      </div>

      <WebhookTabs />
    </div>
  );
}
