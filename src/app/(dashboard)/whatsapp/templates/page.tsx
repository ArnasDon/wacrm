"use client";

import { TemplateManager } from "@/components/settings/template-manager";

export default function WhatsAppTemplatesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          WhatsApp templates
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage Meta message templates. Create from 50+ ready-to-use starters,
          or edit on a dedicated page with a live phone preview.
        </p>
      </div>
      <TemplateManager />
    </div>
  );
}
