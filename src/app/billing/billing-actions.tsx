"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeCpfCnpj } from "@/lib/billing/cpf-cnpj";

export function BillingActions({
  status,
  initialCpfCnpj,
}: {
  status: string;
  initialCpfCnpj: string;
}) {
  const t = useTranslations("Billing");
  const [loading, setLoading] = useState(false);
  const [cpfCnpj, setCpfCnpj] = useState(initialCpfCnpj);

  const subscribe = async () => {
    const normalized = normalizeCpfCnpj(cpfCnpj);
    if (!normalized) {
      toast.error(t("cpfCnpjInvalid"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cpfCnpj: normalized }),
      });
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cpf-cnpj">{t("cpfCnpjLabel")}</Label>
        <Input
          id="cpf-cnpj"
          value={cpfCnpj}
          onChange={(e) => setCpfCnpj(e.target.value)}
          placeholder={t("cpfCnpjPlaceholder")}
          disabled={loading}
        />
      </div>
      <Button onClick={subscribe} disabled={loading}>
        {t("subscribeBtn")}
      </Button>
    </div>
  );
}
