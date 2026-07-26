"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ApprovalRequestDto } from "@/lib/flows/approval-api";

type HumanDecision = "approved" | "rejected";

export default function ApprovalDetailPage() {
  const t = useTranslations("Approvals");
  const { id } = useParams<{ id: string }>();
  const [approval, setApproval] = useState<ApprovalRequestDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] =
    useState<HumanDecision | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/flow-approvals/${encodeURIComponent(id)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("not_found");
        return (await response.json()) as { approval: ApprovalRequestDto };
      })
      .then(({ approval: next }) => {
        if (!cancelled) setApproval(next);
      })
      .catch(() => {
        if (!cancelled) setError(t("notFound"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  async function decide() {
    if (!approval || !pendingDecision) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/flow-approvals/${encodeURIComponent(id)}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decision: pendingDecision,
            expected_revision: approval.revision,
            note: note.trim() || undefined,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        approval?: ApprovalRequestDto;
        error?: string;
      };
      if (!response.ok || !payload.approval) {
        throw new Error(payload.error ?? t("decisionError"));
      }
      setApproval(payload.approval);
      setPendingDecision(null);
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("decisionError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!approval) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {error ?? t("notFound")}
      </p>
    );
  }
  const terminal = approval.decision !== null;

  return (
    <main className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-xs">
            {t("nodeContext", { node: approval.node_key })}
          </p>
          <h1 className="mt-1 text-2xl font-bold">{approval.title}</h1>
        </div>
        <Badge variant={terminal ? "secondary" : "outline"}>
          {approval.decision
            ? t(`decision.${approval.decision}`)
            : t("decision.pending")}
        </Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("requestContext")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="whitespace-pre-wrap text-sm">{approval.message}</p>
          <dl className="text-muted-foreground grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt>{t("flowVersion")}</dt>
              <dd className="text-foreground font-mono">
                {approval.flow_version_id}
              </dd>
            </div>
            <div>
              <dt>{t("expires")}</dt>
              <dd className="text-foreground">
                {new Date(approval.expires_at).toLocaleString()}
              </dd>
            </div>
          </dl>
          {approval.decision_note && (
            <div className="bg-muted rounded-md p-3 text-sm">
              <p className="text-muted-foreground mb-1 text-xs">
                {t("decisionNote")}
              </p>
              <p className="whitespace-pre-wrap">{approval.decision_note}</p>
            </div>
          )}
        </CardContent>
      </Card>
      <p role="status" aria-live="polite" className="text-sm">
        {terminal
          ? t("terminal", {
              decision: t(`decision.${approval.decision}`),
            })
          : t("pending")}
      </p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {!terminal && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPendingDecision("approved")}>
            <Check className="h-4 w-4" />
            {t("approve")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => setPendingDecision("rejected")}
          >
            <X className="h-4 w-4" />
            {t("reject")}
          </Button>
        </div>
      )}

      <Dialog
        open={pendingDecision !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) setPendingDecision(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingDecision === "approved"
                ? t("confirmApprove")
                : t("confirmReject")}
            </DialogTitle>
            <DialogDescription>{t("confirmDescription")}</DialogDescription>
          </DialogHeader>
          <label className="text-sm">
            {t("note")}
            <Textarea
              className="mt-1"
              maxLength={1_000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => setPendingDecision(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant={
                pendingDecision === "rejected" ? "destructive" : "default"
              }
              disabled={submitting}
              onClick={() => void decide()}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
