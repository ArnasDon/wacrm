"use client";

/**
 * Editor toolbar — flow name / description, status chip, dirty
 * indicator, and the action buttons (Save, Activate/Pause, Delete,
 * View runs, Back).
 *
 * Restyled to the Flow Builder design handoff: a single compact
 * toolbar row (back · icon · inline-editable name · status chip ·
 * edited dot on the left; Runs · Delete · Activate · Save on the
 * right) followed by a subtle, full-width description "note" line.
 * Replaces the old three-row stack so the editor reads as one app
 * chrome bar above the canvas/list stage.
 *
 * Lifted out of flow-builder.tsx so the same toolbar renders above
 * both views in FlowEditorShell. Without this, canvas users had no
 * way to save without toggling to list view.
 *
 * Reads everything from the editor context (`useFlowEditor`) so it
 * stays in sync with whichever view is mutating state, and routes
 * router navigation locally (back to /flows, View runs to
 * /flows/[id]/runs) — those don't belong in the hook.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CircleDot,
  History,
  Loader2,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Save,
  Trash2,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  useFlowEditor,
  type BuilderState,
} from "./flow-editor-state";

export function EditorHeader() {
  const router = useRouter();
  const {
    flow,
    state,
    setState,
    dirty,
    saving,
    activating,
    canActivate,
    save,
    setStatus,
    publish,
    deleteFlow,
    versions,
    versionsLoading,
    canManageVersions,
    publishedVersionId,
    restoreVersion,
  } = useFlowEditor();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishLabel, setPublishLabel] = useState("");
  const publishedVersion = versions.find(
    (version) => version.id === publishedVersionId,
  );

  return (
    <div className="flex flex-col gap-1.5 px-6 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        {/* ---- left: back · icon · name · status · edited ---- */}
        <button
          type="button"
          onClick={() => router.push("/flows")}
          title="Back to Flows"
          aria-label="Back to Flows"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Workflow className="h-[18px] w-[18px]" />
        </span>
        <input
          value={state.name}
          onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
          placeholder="Flow name"
          spellCheck={false}
          aria-label="Flow name"
          className="min-w-[120px] max-w-[340px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-bold leading-tight tracking-tight text-foreground outline-none transition-colors hover:bg-muted focus:border-primary focus:bg-transparent focus:shadow-[0_0_0_3px_var(--primary-soft)]"
        />
        <StatusChip status={state.status} />
        <span className="text-xs text-muted-foreground">
          {publishedVersion
            ? `Published v${publishedVersion.version}`
            : publishedVersionId
              ? "Published version"
              : "Not published"}
        </span>
        {dirty && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-300"
            title="Unsaved changes — hit Save to persist"
            aria-live="polite"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Edited
          </span>
        )}

        {/* ---- right: runs · delete · activate · save ---- */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {canManageVersions && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <History className="h-3.5 w-3.5" />
              Versions
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/flows/${flow.id}/runs`)}
          >
            <History className="h-3.5 w-3.5" />
            Runs
            <span className="ml-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {flow.execution_count}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void deleteFlow()}
            className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
          {state.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setStatus("draft")}
              disabled={activating}
            >
              {activating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5" />
              )}
              Pause
            </Button>
          )}
          {canManageVersions && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPublishLabel("");
                setPublishOpen(true);
              }}
              disabled={activating || !canActivate}
              title={
                !canActivate
                  ? "Fix the issues below before publishing"
                  : "Save the draft and publish a new immutable version"
              }
            >
              {activating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              Publish
            </Button>
          )}
          <Button onClick={() => void save()} disabled={saving} size="sm">
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save Draft
          </Button>
        </div>
      </div>

      {canManageVersions && historyOpen && (
        <div className="mt-2 rounded-lg border border-border bg-card p-3">
          <div className="mb-2 text-xs font-semibold text-foreground">
            Published version history
          </div>
          {versionsLoading ? (
            <div className="text-xs text-muted-foreground">
              Loading versions…
            </div>
          ) : versions.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              Publish this draft to create its first version.
            </div>
          ) : (
            <div className="space-y-1.5">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2 text-xs"
                >
                  <span className="font-semibold">v{version.version}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {version.label || "Unlabelled publication"}
                  </span>
                  {version.id === publishedVersionId && (
                    <span className="text-emerald-400">Live</span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={activating}
                    onClick={() => {
                      const confirmed = window.confirm(
                        `Restore version ${version.version}? This overwrites the current editable draft, including unsaved changes. The live published version will not change until you publish again.`,
                      );
                      if (confirmed) void restoreVersion(version.id);
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restore draft
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- description note (subtle, inline-editable) ---- */}
      <input
        value={state.description}
        onChange={(e) =>
          setState((s) => ({ ...s, description: e.target.value }))
        }
        placeholder="Add a short description (internal — customers don't see this)"
        aria-label="Flow description"
        className="w-full max-w-[78ch] rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] text-muted-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-muted/50 focus:border-primary focus:bg-transparent focus:text-foreground"
      />

      <Dialog
        open={canManageVersions && publishOpen}
        onOpenChange={setPublishOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish flow</DialogTitle>
            <DialogDescription>
              Save the current draft and create a new immutable version for
              future runs.
            </DialogDescription>
          </DialogHeader>
          <label
            htmlFor="flow-version-label"
            className="space-y-1.5 text-sm font-medium"
          >
            <span>
              Version label{" "}
              <span className="font-normal text-muted-foreground">
                Optional
              </span>
            </span>
            <Input
              id="flow-version-label"
              aria-label="Version label"
              value={publishLabel}
              maxLength={120}
              placeholder="e.g. Updated support routing"
              onChange={(event) => setPublishLabel(event.target.value)}
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={activating}
              onClick={() => {
                setPublishOpen(false);
                void publish(publishLabel);
              }}
            >
              {activating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusChip({ status }: { status: BuilderState["status"] }) {
  const cfg = {
    draft: {
      // Neutral, not amber — amber is reserved for the adjacent
      // "Edited" dirty signal, so the two don't read as the same alert.
      cls: "border-border bg-muted text-muted-foreground",
      label: "Draft",
    },
    active: {
      cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
      label: "Active",
    },
    archived: {
      cls: "border-border bg-muted/50 text-muted-foreground",
      label: "Archived",
    },
  }[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium",
        cfg.cls,
      )}
    >
      <CircleDot className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}
