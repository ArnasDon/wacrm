"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, Pipeline, PipelineStage } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface SendToPipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
}

/**
 * Drops the active conversation's contact into a pipeline stage as a
 * new deal — the inbox-side counterpart to deal-card.tsx's "open
 * conversation" (which goes the other way, pipeline → inbox). Deals
 * have no uniqueness constraint (see migrations), so this is a plain
 * insert, same as DealForm's create path — no API route needed, RLS
 * on `deals` (requires 'agent'+) is the authorization boundary.
 */
export function SendToPipelineDialog({
  open,
  onOpenChange,
  contact,
}: SendToPipelineDialogProps) {
  const t = useTranslations("Inbox.sendToPipeline");
  const supabase = createClient();
  const { user, accountId, defaultCurrency } = useAuth();

  const [loading, setLoading] = useState(true);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [p, s] = await Promise.all([
        supabase.from("pipelines").select("*").order("created_at"),
        supabase.from("pipeline_stages").select("*").order("position"),
      ]);
      if (cancelled) return;
      const pipelineRows = (p.data ?? []) as Pipeline[];
      const stageRows = (s.data ?? []) as PipelineStage[];
      setPipelines(pipelineRows);
      setStages(stageRows);
      // Default to the first pipeline (and its first stage) so the
      // common single-pipeline case is a one-click confirm.
      const firstPipelineId = pipelineRows[0]?.id ?? "";
      setPipelineId(firstPipelineId);
      setStageId(
        stageRows.find((st) => st.pipeline_id === firstPipelineId)?.id ?? "",
      );
      setTitle("");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  const stagesForPipeline = stages.filter((s) => s.pipeline_id === pipelineId);

  function handlePipelineChange(id: string) {
    setPipelineId(id);
    setStageId(stages.find((s) => s.pipeline_id === id)?.id ?? "");
  }

  async function handleCreate() {
    if (!contact || !pipelineId || !stageId || !user || !accountId) return;
    setSaving(true);
    // Same "don't block on naming it" default as DealForm — falls back
    // to the contact's name/phone when left blank.
    const resolvedTitle = title.trim() || contact.name || contact.phone;
    const { error } = await supabase.from("deals").insert({
      title: resolvedTitle,
      value: 0,
      currency: defaultCurrency,
      contact_id: contact.id,
      pipeline_id: pipelineId,
      stage_id: stageId,
      user_id: user.id,
      account_id: accountId,
      status: "open",
    });
    setSaving(false);
    if (error) {
      console.error("Failed to create deal from inbox:", error);
      toast.error(t("toastFailed"));
      return;
    }
    const pipelineName = pipelines.find((p) => p.id === pipelineId)?.name ?? "";
    const stageName = stagesForPipeline.find((s) => s.id === stageId)?.name ?? "";
    toast.success(t("toastCreated", { pipeline: pipelineName, stage: stageName }));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t("dialogTitle")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("dialogDesc", { name: contact?.name || contact?.phone || "" })}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : pipelines.length === 0 ? (
          <div className="rounded-md border border-border bg-background/50 p-6 text-center">
            <p className="text-sm text-popover-foreground">{t("noPipelines")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("noPipelinesHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t("pipeline")}</Label>
              <Select
                items={Object.fromEntries(pipelines.map((p) => [p.id, p.name]))}
                value={pipelineId}
                onValueChange={(val) => {
                  if (!val) return;
                  handlePipelineChange(val);
                }}
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue placeholder={t("selectPipeline")} />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {pipelines.map((p) => (
                    <SelectItem
                      key={p.id}
                      value={p.id}
                      className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                    >
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t("stage")}</Label>
              <Select
                items={Object.fromEntries(
                  stagesForPipeline.map((s) => [s.id, s.name]),
                )}
                value={stageId}
                onValueChange={(val) => {
                  if (!val) return;
                  setStageId(val);
                }}
                disabled={stagesForPipeline.length === 0}
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground disabled:opacity-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {stagesForPipeline.map((s) => (
                    <SelectItem
                      key={s.id}
                      value={s.id}
                      className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                    >
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">
                {t("dealTitle")}{" "}
                <span className="text-xs font-normal">{t("dealTitleOptional")}</span>
              </Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={contact?.name || contact?.phone || t("dealTitlePlaceholder")}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={saving || loading || pipelines.length === 0 || !pipelineId || !stageId}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("creating")}
              </>
            ) : (
              t("create")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
