"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function BillingActions({ status }: { status: string }) {
  const t = useTranslations("Billing");
  const [loading, setLoading] = useState(false);

  const subscribe = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/subscribe", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "failed");
      window.location.href = json.invoiceUrl;
    } catch {
      toast.error(t("subscribeError"));
      setLoading(false);
    }
  };

  const cancel = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      if (!res.ok) throw new Error("failed");
      toast.success(t("cancelSuccess"));
      window.location.reload();
    } catch {
      toast.error(t("cancelError"));
      setLoading(false);
    }
  };

  if (status === "active") {
    return (
      <Button variant="outline" onClick={cancel} disabled={loading}>
        {t("cancelBtn")}
      </Button>
    );
  }

  return (
    <Button onClick={subscribe} disabled={loading}>
      {t("subscribeBtn")}
    </Button>
  );
}
