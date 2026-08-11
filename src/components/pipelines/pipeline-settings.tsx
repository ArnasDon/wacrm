"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Trash2,
  Plus,
  GripVertical,
  AlertTriangle,
  Lock,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AVAILABLE_REQUIRED_FIELDS,
  type StageRequiredField,
} from "@/lib/pipelines/validation";

const STAGE_COLORS = [
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
];

/** A stage is protected if the DB flag is set OR the name is one of the
 * reserved outcome stages. The name check is a belt-and-suspenders guard
 * for rows fetched before migration 038 ran.
 */
function isStageProtected(stage: PipelineStage): boolean {
  if (stage.is_protected) return true;
  const n = stage.name.toLowerCase();
  return n === "ganho" || n === "perdido";
}

interface PipelineSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: Pipeline;
  stages: PipelineStage[];
  onPipelinesChanged: () => void;
  onStagesChanged: () => void;
  onCreateNewPipeline: () => void;
}

export function PipelineSettings({
  open,
  onOpenChange,
  pipeline,
  stages,
  onPipelinesChanged,
  onStagesChanged,
  onCreateNewPipeline,
}: PipelineSettingsProps) {
  const t = useTranslations("Pipelines.settings");
  const supabase = createClient();

  const [name, setName] = useState(pipeline.name);
  const [localStages, setLocalStages] = useState<PipelineStage[]>(stages);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset form state when the dialog opens or its prop inputs change
  // — legitimate prop-driven sync.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setName(pipeline.name);
    setLocalStages([...stages].sort((a, b) => a.position - b.position));
    setShowDeleteConfirm(false);
  }, [open, pipeline, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localStages.findIndex((s) => s.id === active.id);
    const newIndex = localStages.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setLocalStages(arrayMove(localStages, oldIndex, newIndex));
  }

  async function handleSave() {
    setSaving(true);

    const stageRows = localStages.map((s, i) => ({
      id: s.id,
      pipeline_id: s.pipeline_id,
      name: s.name,
      color: s.color,
      position: i,
      required_fields: s.required_fields || [],
    }));

    const renamePromise = supabase
      .from("pipelines")
      .update({ name: name.trim() })
      .eq("id", pipeline.id);

    let stagesRes = await supabase
      .from("pipeline_stages")
      .upsert(stageRows, { onConflict: "id" });

    // Fallback: If DB table doesn't have required_fields column yet, retry without required_fields
    if (stagesRes.error) {
      console.warn(
        "Stage upsert with required_fields failed, retrying without required_fields:",
        stagesRes.error.message
      );
      const stageRowsFallback = localStages.map((s, i) => ({
        id: s.id,
        pipeline_id: s.pipeline_id,
        name: s.name,
        color: s.color,
        position: i,
      }));
      stagesRes = await supabase
        .from("pipeline_stages")
        .upsert(stageRowsFallback, { onConflict: "id" });
    }

    const renameRes = await renamePromise;

    setSaving(false);

    if (renameRes.error || stagesRes.error) {
      console.error("Failed to save pipeline:", renameRes.error || stagesRes.error);
      toast.error(t("toastFailedSave"));
      return;
    }

    onOpenChange(false);
    onPipelinesChanged();
    onStagesChanged();
    toast.success(t("toastSaved"));
  }

  async function handleAddStage() {
    const trimmed = newStageName.trim();
    if (!trimmed) return;
    const { data, error } = await supabase
      .from("pipeline_stages")
      .insert({
        pipeline_id: pipeline.id,
        name: trimmed,
        color: newStageColor,
        position: localStages.length,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(t("toastFailedAddStage"));
      return;
    }
    setLocalStages([...localStages, data as PipelineStage]);
    setNewStageName("");
    setNewStageColor(STAGE_COLORS[(localStages.length + 1) % STAGE_COLORS.length]);
  }

  async function handleRemoveStage(stageId: string) {
    const stage = localStages.find((s) => s.id === stageId);
    if (stage && isStageProtected(stage)) {
      toast.error(t("toastCannotDeleteProtectedStage"));
      return;
    }
    // Refuse to delete if deals still reference the stage (FK would fail).
    const { count } = await supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stageId);
    if (count && count > 0) {
      toast.error(t("toastMoveOrDeleteDeals"));
      return;
    }
    const { error } = await supabase
      .from("pipeline_stages")
      .delete()
      .eq("id", stageId);
    if (error) {
      toast.error(t("toastFailedDeleteStage"));
      return;
    }
    setLocalStages(localStages.filter((s) => s.id !== stageId));
  }

  async function handleDeletePipeline() {
    setDeleting(true);
    // ON DELETE CASCADE handles deals + stages.
    const { error } = await supabase
      .from("pipelines")
      .delete()
      .eq("id", pipeline.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDeletePipeline"));
      return;
    }
    onOpenChange(false);
    onPipelinesChanged();
    toast.success(t("toastDeleted"));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("managePipeline")}</DialogTitle>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="py-4">
            <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-400">
                  {t("deletePipeline")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("deletePipelineDesc")}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleDeletePipeline}
                disabled={deleting}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {deleting ? t("deleting") : t("deletePipelineBtn")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("pipelineName")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="border-border bg-muted text-foreground"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("stages")}</Label>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleReorder}
                >
                  <SortableContext
                    items={localStages.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {localStages.map((stage, index) => (
                        <SortableStageRow
                          key={stage.id}
                          stage={stage}
                          protected={isStageProtected(stage)}
                          onNameChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], name: v };
                            setLocalStages(updated);
                          }}
                          onColorChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], color: v };
                            setLocalStages(updated);
                          }}
                          onRequiredFieldsChange={(reqs) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], required_fields: reqs };
                            setLocalStages(updated);
                          }}
                          onRemove={() => handleRemoveStage(stage.id)}
                          colors={STAGE_COLORS}
                          t={t}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                {/* Add new stage */}
                <div className="mt-1 flex flex-wrap gap-1">
                  {STAGE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewStageColor(color)}
                      className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: color,
                        borderColor:
                          newStageColor === color
                            ? "var(--foreground)"
                            : "transparent",
                      }}
                      aria-label={`Pick color ${color}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    placeholder={t("newStageNamePlaceholder")}
                    className="border-border bg-muted text-sm text-foreground"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddStage();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddStage}
                    disabled={!newStageName.trim()}
                    className="shrink-0 border-border bg-transparent text-muted-foreground hover:bg-muted"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t("add")}
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={onCreateNewPipeline}
                className="w-full border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                <Plus className="mr-1 h-3 w-3" />
                {t("createNewPipeline")}
              </Button>
            </div>

            <DialogFooter className="border-border bg-popover/50">
              <Button
                onClick={() => setShowDeleteConfirm(true)}
                className="mr-auto bg-red-600 text-white hover:bg-red-700"
              >
                {t("deletePipeline")}
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : t("saveChanges")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SortableStageRow({
  stage,
  protected: isProtected,
  onNameChange,
  onColorChange,
  onRequiredFieldsChange,
  onRemove,
  colors,
  t,
}: {
  stage: PipelineStage;
  protected: boolean;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onRequiredFieldsChange: (v: StageRequiredField[]) => void;
  onRemove: () => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const requiredCount = stage.required_fields?.length ?? 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg border bg-muted p-2 ${
        isProtected ? "border-primary/30" : "border-border"
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={t("dragToReorder")}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <ColorSwatch value={stage.color} onChange={isProtected ? () => {} : onColorChange} colors={colors} t={t} />
      <Input
        value={stage.name}
        onChange={(e) => !isProtected && onNameChange(e.target.value)}
        readOnly={isProtected}
        className={`h-7 flex-1 border-transparent bg-transparent text-sm text-foreground focus:border-border ${
          isProtected ? "cursor-default select-none opacity-80" : ""
        }`}
      />

      {/* Required fields popover trigger */}
      <Popover>
        <PopoverTrigger
          className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
            requiredCount > 0
              ? "border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
              : "border-border/60 text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
          }`}
          title="Campos obrigatórios para mover para esta etapa"
        >
          <ListChecks className="h-3.5 w-3.5" />
          {requiredCount > 0 && (
            <span className="text-[10px] font-bold">{requiredCount}</span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3 bg-popover border-border">
          <PopoverHeader className="pb-2 border-b border-border">
            <PopoverTitle className="text-xs font-semibold text-foreground">
              Campos Obrigatórios ({stage.name})
            </PopoverTitle>
            <p className="text-[11px] text-muted-foreground">
              Dados necessários para o deal poder ser movido para esta etapa:
            </p>
          </PopoverHeader>
          <div className="mt-2 space-y-2">
            {AVAILABLE_REQUIRED_FIELDS.map((item) => {
              const isChecked = (stage.required_fields || []).includes(item.id);
              return (
                <label
                  key={item.id}
                  className="flex items-center gap-2 cursor-pointer text-xs text-foreground hover:bg-muted/50 p-1 rounded"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={(checked) => {
                      const current = stage.required_fields || [];
                      if (checked) {
                        onRequiredFieldsChange([...current, item.id]);
                      } else {
                        onRequiredFieldsChange(current.filter((f) => f !== item.id));
                      }
                    }}
                  />
                  <span>{item.label}</span>
                </label>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {isProtected ? (
        <span
          title={t("protectedStageTooltip")}
          className="flex items-center justify-center text-primary/60"
        >
          <Lock className="h-3.5 w-3.5" />
        </span>
      ) : (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          className="text-muted-foreground hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

function ColorSwatch({
  value,
  onChange,
  colors,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-4 w-4 rounded-full border border-border"
        style={{ backgroundColor: value }}
        aria-label={t("changeColor")}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-20 flex flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg w-36">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  borderColor:
                    c === value ? "var(--foreground)" : "transparent",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
