"use client";

// /partners — Main Users only. A SubUser who opens this URL directly
// gets the Access Denied state; the API behind it returns 403 for
// them regardless (requireMainUser), so this is presentation only.

import { ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { PartnersManager } from "@/components/partners/partners-manager";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export default function PartnersPage() {
  const t = useTranslations("Partners");
  const { profileLoading, canManagePartners } = useAuth();

  if (profileLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!canManagePartners) {
    return (
      <Card className="mx-auto mt-12 max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-red-500/10">
            <ShieldAlert className="size-6 text-red-500" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">{t("accessDenied.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("accessDenied.desc")}</p>
        </CardContent>
      </Card>
    );
  }

  return <PartnersManager />;
}
