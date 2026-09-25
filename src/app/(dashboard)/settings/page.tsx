"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, Bot, Building2, CreditCard, HardDrive, Mail, MessageSquare, Palette, User, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/sales/kit";
import { AISettings } from "@/components/settings-v2/ai-settings";
import { BusinessSettings } from "@/components/settings-v2/business-settings";
import { EmailSettings } from "@/components/settings-v2/email-settings";
import { PaymentsSettings } from "@/components/settings-v2/payments-settings";
import { ProfileSettings } from "@/components/settings-v2/profile-settings";
import { StorageSettings } from "@/components/settings-v2/storage-settings";
import { TelegramSettings } from "@/components/settings-v2/telegram-settings";
import { WhatsAppSettings } from "@/components/settings-v2/whatsapp-settings";
import { MembersTab } from "@/components/settings/members-tab";
import { AppearancePanel } from "@/components/settings/appearance-panel";

// `admin` = needs the account-admin role. `platform` = the connections
// the platform operator owns (keys, numbers, bots, buckets); merchants
// never see these, they are set up for them.
const TABS = [
  { key: "business", label: "Business", icon: Building2, admin: false, platform: false },
  { key: "payments", label: "Payments", icon: CreditCard, admin: true, platform: false },
  { key: "team", label: "Team", icon: Users, admin: false, platform: false },
  { key: "profile", label: "Profile", icon: User, admin: false, platform: false },
  { key: "appearance", label: "Appearance", icon: Palette, admin: false, platform: false },
  { key: "whatsapp", label: "WhatsApp", icon: MessageSquare, admin: true, platform: true },
  { key: "ai", label: "AI providers", icon: Bot, admin: true, platform: true },
  { key: "telegram", label: "Telegram", icon: Bell, admin: true, platform: true },
  { key: "storage", label: "Storage", icon: HardDrive, admin: true, platform: true },
  { key: "email", label: "Email", icon: Mail, admin: true, platform: true },
] as const;

function SettingsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { canEditSettings, platformAdmin } = useAuth();
  const tabs = TABS.filter((t) => (!t.admin || canEditSettings) && (!t.platform || platformAdmin));
  const current = tabs.find((t) => t.key === params.get("tab"))?.key ?? "business";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Settings"
        description={
          platformAdmin
            ? "Connections (WhatsApp, AI, Telegram, storage, email) are set up here for whichever account you have open."
            : canEditSettings
              ? "WhatsApp, AI and alerts are managed for you — contact support to change them."
              : "Some settings are only visible to admins."
        }
      />
      <div className="flex flex-col gap-5 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col" aria-label="Settings sections">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => router.replace(`/settings?tab=${t.key}`)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition-colors ${current === t.key ? "bg-primary/10 text-primary" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {current === "business" && <BusinessSettings />}
          {current === "whatsapp" && <WhatsAppSettings />}
          {current === "payments" && <PaymentsSettings />}
          {current === "ai" && <AISettings />}
          {current === "email" && <EmailSettings />}
          {current === "storage" && <StorageSettings />}
          {current === "telegram" && <TelegramSettings />}
          {current === "team" && <MembersTab />}
          {current === "profile" && <ProfileSettings />}
          {current === "appearance" && <AppearancePanel />}
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsInner />
    </Suspense>
  );
}
