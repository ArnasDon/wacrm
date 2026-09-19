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

const TABS = [
  { key: "business", label: "Business", icon: Building2, admin: false },
  { key: "whatsapp", label: "WhatsApp", icon: MessageSquare, admin: false },
  { key: "payments", label: "Payments", icon: CreditCard, admin: true },
  { key: "ai", label: "AI providers", icon: Bot, admin: true },
  { key: "email", label: "Email", icon: Mail, admin: true },
  { key: "storage", label: "Storage", icon: HardDrive, admin: true },
  { key: "telegram", label: "Telegram alerts", icon: Bell, admin: true },
  { key: "team", label: "Team", icon: Users, admin: false },
  { key: "profile", label: "Profile", icon: User, admin: false },
  { key: "appearance", label: "Appearance", icon: Palette, admin: false },
] as const;

function SettingsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { canEditSettings } = useAuth();
  const tabs = TABS.filter((t) => !t.admin || canEditSettings);
  const current = tabs.find((t) => t.key === params.get("tab"))?.key ?? "business";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Settings" description={canEditSettings ? undefined : "Some settings are only visible to admins."} />
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
