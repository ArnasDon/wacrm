"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckSquare2, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ApprovalRequestDto } from "@/lib/flows/approval-api";

export default function ApprovalsPage() {
  const t = useTranslations("Approvals");
  const [items, setItems] = useState<ApprovalRequestDto[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/flow-approvals", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("load_failed");
        return (await response.json()) as { approvals: ApprovalRequestDto[] };
      })
      .then(({ approvals }) => {
        if (!cancelled) setItems(approvals);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("listTitle")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("listDescription")}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {t("loadError")}
        </p>
      ) : items === null ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="text-primary h-6 w-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="border-border bg-muted/30 flex h-40 flex-col items-center justify-center rounded-xl border border-dashed">
          <CheckSquare2 className="text-muted-foreground h-6 w-6" />
          <p className="mt-2 text-sm font-medium">{t("empty")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((approval) => (
            <li key={approval.id}>
              <Link
                href={`/approvals/${approval.id}`}
                className="border-border bg-card hover:border-primary/40 flex items-center justify-between gap-4 rounded-xl border p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {approval.title}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("nodeContext", { node: approval.node_key })}
                  </p>
                </div>
                <Badge variant="outline">
                  {approval.decision
                    ? t(`decision.${approval.decision}`)
                    : t("decision.pending")}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
