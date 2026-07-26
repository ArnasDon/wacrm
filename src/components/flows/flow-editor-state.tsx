"use client";

/**
 * Single source of truth for the flow editor's state.
 *
 * Both views (list and canvas) read and mutate the same `BuilderState`
 * via `useFlowEditor()`. The provider mounts once inside
 * `FlowEditorShell`, so toggling views never resets unsaved edits.
 *
 * What lives here:
 *   - `BuilderState` shape (header fields, trigger config, nodes).
 *   - Dirty / saving / activating flags so the header save button
 *     and the beforeunload guard share the same source.
 *   - All mutations: name / description / trigger / fallback,
 *     addNode / updateNode / updateNodeConfig / updateNodePosition /
 *     removeNode, setEntryNodeId.
 *   - Side effects: save (PUT), setStatus (POST /activate),
 *     deleteFlow (DELETE then router.push).
 *   - Validation issues + the canActivate boolean.
 *
 * What does NOT live here:
 *   - List-view UI state (expanded card set, scroll refs,
 *     flash-on-jump) — those are list-only and stay in
 *     `flow-builder.tsx`.
 *   - Canvas-view UI state (selected node id, side-sheet open) —
 *     those are canvas-only and stay in `flow-canvas.tsx`.
 *
 * `removeNode` does NOT auto-clean inbound edges. The list-view's
 * NodeKeySelect dropdowns and the validator both surface dangling
 * `next_node_key` references; that visibility is enough for v1. PR 2b
 * (canvas delete via keyboard) will revisit if the canvas adds an
 * implicit-delete affordance that's easier to trip accidentally.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  validateFlowForActivation,
  type ValidationIssue,
} from "@/lib/flows/validate";
import { useTranslations } from "next-intl";
import { unlinkNodeReferences } from "@/lib/flows/edges";
import { resolveFallbackPolicy } from "@/lib/flows/fallback";
import {
  canonicalNodeType,
  getNodeDescriptor,
} from "@/lib/flows/registry";
import type {
  FlowFallbackPolicy,
  FlowNodeRow,
  FlowRow,
} from "@/lib/flows/types";
import type { FlowVariableDeclaration } from "@/lib/flows/runtime-primitives";
import type { FlowVersionGraph } from "@/lib/flows/versions";
import { NODE_META, slugify, type BuilderNode, type NodeType } from "./shared";
import { normalizeNodeErrorHandlingConfig } from "./forms/error-handling-options";

// ============================================================
// State shape
// ============================================================

export interface BuilderState {
  name: string;
  description: string;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  fallback_policy: FlowFallbackPolicy;
  variable_schema: FlowVariableDeclaration[];
  status: FlowRow["status"];
  nodes: BuilderNode[];
}

export interface FlowEditorContextValue {
  /** Immutable post-load envelope: id, created_at, fallback_policy, etc. */
  flow: FlowRow;

  // Authored state
  state: BuilderState;
  /**
   * Dirty-tracking React setState. Flips `dirty` on every call. Used
   * by the list view's existing subcomponents (Header, TriggerPanel,
   * EntryPicker) which mutate multiple fields atomically — granular
   * setters below would force them to fan out the update.
   */
  setState: (
    updaterOrValue:
      | BuilderState
      | ((prev: BuilderState) => BuilderState),
  ) => void;
  dirty: boolean;
  saving: boolean;
  activating: boolean;
  issues: ValidationIssue[];
  canActivate: boolean;
  versions: FlowVersionSummary[];
  versionsLoading: boolean;
  canManageVersions: boolean;
  publishedVersionId: string | null;
  draftRevision: number;
  /** Shared by canvas, list and the debug inspector. */
  selectedNodeKey: string | null;
  setSelectedNodeKey: (key: string | null) => void;

  // Node mutations. addNode returns the generated key so the caller
  // (a NodeCard "Add" button or canvas "+" button) can scroll to /
  // focus / open the new node.
  addNode: (type: NodeType) => string;
  updateNode: (key: string, patch: Partial<BuilderNode>) => void;
  updateNodeConfig: (key: string, patch: Record<string, unknown>) => void;
  updateNodePosition: (key: string, x: number, y: number) => void;
  updateNodePositions: (
    positions: Record<string, { x: number; y: number }>,
  ) => void;
  removeNode: (key: string) => void;

  // Actions
  save: () => Promise<boolean>;
  setStatus: (
    status: BuilderState["status"],
    label?: string | null,
  ) => Promise<void>;
  publish: (label?: string | null) => Promise<void>;
  reloadVersions: () => Promise<void>;
  restoreVersion: (versionId: string) => Promise<void>;
  deleteFlow: () => Promise<void>;

  /**
   * Transient "look here" signal. Set when the validation panel's
   * issue is clicked — both views subscribe: list scrolls the row
   * into view and flashes its border, canvas pans the viewport to
   * the node and flashes its card. Auto-clears after 1600ms so the
   * flash is a one-shot.
   *
   * Lives in context (not local view state) so the panel can be
   * rendered ONCE in the shell and trigger flashes in whichever
   * view is currently mounted, without per-view plumbing.
   */
  flashKey: string | null;
  requestFlash: (key: string) => void;
}

// ============================================================
// Helpers — node_key generation + per-type default configs
// ============================================================

export function uniqueNodeKey(base: string, existing: BuilderNode[]): string {
  if (!existing.some((n) => n.node_key === base)) return base;
  let i = 2;
  while (existing.some((n) => n.node_key === `${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

export function defaultConfigFor(type: NodeType): Record<string, unknown> {
  const defaults = getNodeDescriptor(type)?.builder.defaultConfig ?? {};
  return structuredClone(defaults);
}

export interface FlowVersionSummary {
  id: string;
  flow_id: string;
  version: number;
  published_at: string;
  published_by: string | null;
  label: string | null;
}

export function applyNodePositions(
  nodes: BuilderNode[],
  positions: Record<string, { x: number; y: number }>,
): BuilderNode[] {
  return nodes.map((n) => {
    const next = positions[n.node_key];
    return next
      ? {
          ...n,
          position_x: Math.round(next.x),
          position_y: Math.round(next.y),
        }
      : n;
  });
}

export function applyNodeConfigPatch(
  node: BuilderNode,
  patch: Record<string, unknown>,
): BuilderNode {
  return {
    ...node,
    config: normalizeNodeErrorHandlingConfig(node.node_type, {
      ...node.config,
      ...patch,
    }),
  };
}

export function removeNodeAndNormalizeReferences(
  nodes: BuilderNode[],
  deletedKey: string,
): BuilderNode[] {
  const unlinked = unlinkNodeReferences(
    nodes.filter((node) => node.node_key !== deletedKey),
    deletedKey,
  );
  return unlinked.map((node) => {
    const config =
      node.config.on_error === "fail_branch" &&
      node.config.error_next_node_key === deletedKey
        ? { ...node.config, on_error: "fail_run" }
        : node.config;
    return {
      ...node,
      config: normalizeNodeErrorHandlingConfig(node.node_type, config),
    };
  });
}

export function applyRestoredVersion(
  state: BuilderState,
  graph: FlowVersionGraph,
): BuilderState {
  return {
    ...state,
    trigger_type: graph.trigger.type,
    trigger_config: graph.trigger.config,
    entry_node_id: graph.entry_node_key,
    fallback_policy: graph.fallback_policy,
    variable_schema: graph.variable_schema,
    nodes: graph.nodes.map((node) => ({
      node_key: node.node_key,
      node_type: (canonicalNodeType(node.node_type) ??
        node.node_type) as NodeType,
      config: node.config,
      position_x: node.position_x,
      position_y: node.position_y,
    })),
  };
}

export function builderStateToSavePayload(state: BuilderState) {
  return {
    name: state.name,
    description: state.description || null,
    trigger_type: state.trigger_type,
    trigger_config: state.trigger_config,
    entry_node_id: state.entry_node_id,
    fallback_policy: state.fallback_policy,
    variable_schema: state.variable_schema,
    nodes: state.nodes,
  };
}

export function buildDraftSaveRequest(
  state: BuilderState,
  expectedDraftRevision: number,
) {
  return {
    ...builderStateToSavePayload(state),
    expected_draft_revision: expectedDraftRevision,
  };
}

export function versionControlsBehavior(
  canManageVersions: boolean,
  historyStatus: number,
) {
  const historySucceeded = historyStatus >= 200 && historyStatus < 300;
  const expectedNonOwnerDenial =
    !canManageVersions && historyStatus === 403;
  return {
    showControls: canManageVersions,
    shouldReportHistoryError:
      !historySucceeded && !expectedNonOwnerDenial,
  };
}

function builderStateFromRows(
  flow: FlowRow,
  nodes: FlowNodeRow[],
): BuilderState {
  return {
    name: flow.name,
    description: flow.description ?? "",
    trigger_type: flow.trigger_type,
    trigger_config: flow.trigger_config as Record<string, unknown>,
    entry_node_id: flow.entry_node_id,
    fallback_policy: resolveFallbackPolicy(flow.fallback_policy),
    variable_schema: flow.variable_schema ?? [],
    status: flow.status,
    nodes: nodes.map((node) => ({
      node_key: node.node_key,
      node_type: (canonicalNodeType(node.node_type) ??
        node.node_type) as NodeType,
      config: node.config as Record<string, unknown>,
      position_x: node.position_x,
      position_y: node.position_y,
    })),
  };
}

// ============================================================
// Context
// ============================================================

const FlowEditorCtx = createContext<FlowEditorContextValue | null>(null);

export function useFlowEditor(): FlowEditorContextValue {
  const ctx = useContext(FlowEditorCtx);
  if (!ctx) {
    throw new Error(
      "useFlowEditor must be called inside <FlowEditorProvider>",
    );
  }
  return ctx;
}

// ============================================================
// Provider
// ============================================================

interface ProviderProps {
  initialFlow: FlowRow;
  initialNodes: FlowNodeRow[];
  canManageVersions: boolean;
  children: ReactNode;
}

export function FlowEditorProvider({
  initialFlow,
  initialNodes,
  canManageVersions,
  children,
}: ProviderProps) {
  const router = useRouter();
  const t = useTranslations("Flows.editorState");

  const [state, setStateRaw] = useState<BuilderState>(() =>
    builderStateFromRows(initialFlow, initialNodes),
  );

  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [versions, setVersions] = useState<FlowVersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionHistoryStatus, setVersionHistoryStatus] = useState(200);
  const versionControls = useMemo(
    () => versionControlsBehavior(canManageVersions, versionHistoryStatus),
    [canManageVersions, versionHistoryStatus],
  );
  const [publishedVersionId, setPublishedVersionId] = useState(
    initialFlow.published_version_id,
  );
  const [draftRevision, setDraftRevision] = useState(
    initialFlow.draft_revision ?? 0,
  );
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  // dirty flips on user edits; status-only updates (after the activate
  // API succeeds) use setStateRaw so they don't falsely re-flag the
  // form as dirty.
  const [dirty, setDirty] = useState(false);
  const setState = useCallback<typeof setStateRaw>((updaterOrValue) => {
    setDirty(true);
    setStateRaw(updaterOrValue);
  }, []);

  // Cross-view "look here" signal (see FlowEditorContextValue docs).
  // Tracked via a ref alongside state so a rapid second click on a
  // different issue cancels the previous timeout instead of letting
  // the first flash linger past the new one.
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);
  const requestFlash = useCallback((key: string) => {
    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current);
    }
    setFlashKey(key);
    flashTimeoutRef.current = window.setTimeout(() => {
      setFlashKey(null);
      flashTimeoutRef.current = null;
    }, 1600);
  }, []);
  useEffect(
    () => () => {
      if (flashTimeoutRef.current !== null) {
        window.clearTimeout(flashTimeoutRef.current);
      }
    },
    [],
  );

  // Browser-level reload / tab-close / external-link guard. SPA
  // navigation (sidebar links, back button) isn't covered — Next 16
  // routes through the App Router and beforeunload doesn't fire on
  // client-side route changes. That's a follow-up; this catches the
  // accidental refresh / closed-window class of data loss.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the return value but require something
      // truthy to actually show the native prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ---- Validation ----
  const issues = useMemo<ValidationIssue[]>(
    () =>
      validateFlowForActivation(
        {
          name: state.name,
          trigger_type: state.trigger_type,
          trigger_config: state.trigger_config,
          entry_node_id: state.entry_node_id,
          fallback_policy: state.fallback_policy,
          variable_schema: state.variable_schema,
        },
        state.nodes,
      ),
    [state],
  );
  const canActivate = useMemo(
    () => issues.every((i) => i.severity !== "error"),
    [issues],
  );

  const reloadVersions = useCallback(async () => {
    setVersionsLoading(true);
    try {
      const response = await fetch(`/api/flows/${initialFlow.id}/versions`);
      setVersionHistoryStatus(response.status);
      const behavior = versionControlsBehavior(
        canManageVersions,
        response.status,
      );
      if (!response.ok && !behavior.shouldReportHistoryError) {
        setVersions([]);
        return;
      }
      if (!response.ok) {
        throw new Error(`History failed: ${response.status}`);
      }
      const payload = (await response.json()) as {
        versions?: FlowVersionSummary[];
      };
      setVersions(payload.versions ?? []);
    } catch (error) {
      setVersionHistoryStatus((status) => (status >= 400 ? status : 0));
      toast.error(
        error instanceof Error ? error.message : "Version history failed",
      );
    } finally {
      setVersionsLoading(false);
    }
  }, [canManageVersions, initialFlow.id]);

  useEffect(() => {
    void reloadVersions();
  }, [reloadVersions]);

  const reloadDraft = useCallback(async () => {
    const response = await fetch(`/api/flows/${initialFlow.id}`);
    if (!response.ok) {
      throw new Error(`Draft refresh failed: ${response.status}`);
    }
    const payload = (await response.json()) as {
      flow: FlowRow;
      nodes?: FlowNodeRow[];
    };
    setStateRaw(builderStateFromRows(payload.flow, payload.nodes ?? []));
    setDraftRevision(payload.flow.draft_revision ?? 0);
    setPublishedVersionId(payload.flow.published_version_id);
    setDirty(false);
  }, [initialFlow.id]);

  // ---- Save (PUT) ----
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/flows/${initialFlow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildDraftSaveRequest(state, draftRevision)),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Save failed: ${res.status}`);
      }
      const payload = (await res.json()) as { flow?: FlowRow };
      if (payload.flow) {
        setDraftRevision(payload.flow.draft_revision);
        setPublishedVersionId(payload.flow.published_version_id);
      }
      setDirty(false);
      toast.success(t("saved"));
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
      return false;
    } finally {
      setSaving(false);
    }
  }, [draftRevision, initialFlow.id, state, t]);

  // ---- Activate / Pause / Archive ----
  const setStatus = useCallback(
    async (
      next: BuilderState["status"],
      label: string | null = null,
    ) => {
      if (next === "active" && !canActivate) {
        toast.error(t("fixIssues"));
        return;
      }
      setActivating(true);
      try {
        // Always save first so the activation validator sees the
        // latest state — the user shouldn't have to remember "save
        // then activate".
        if (next === "active") {
          const saved = await save();
          if (!saved) return;
        }
        const res = await fetch(`/api/flows/${initialFlow.id}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: next,
            label: next === "active" ? label : null,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? `Status update failed: ${res.status}`);
        }
        const payload = (await res.json()) as {
          version?: FlowVersionSummary;
        };
        setStateRaw((s) => ({ ...s, status: next }));
        if (next === "active" && payload.version) {
          setPublishedVersionId(payload.version.id);
          setVersions((current) => [
            payload.version!,
            ...current.filter((version) => version.id !== payload.version!.id),
          ]);
        }
        toast.success(
          next === "active"
            ? t("statusActivated")
            : next === "archived"
              ? t("statusArchived")
              : t("statusDraft")
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Status update failed";
        toast.error(msg);
      } finally {
        setActivating(false);
      }
    },
    [canActivate, save, initialFlow.id, t],
  );

  const publish = useCallback(
    async (label: string | null = null) => {
      await setStatus("active", label);
    },
    [setStatus],
  );

  const restoreVersion = useCallback(
    async (versionId: string) => {
      setActivating(true);
      try {
        const response = await fetch(
          `/api/flows/${initialFlow.id}/versions/${versionId}/restore`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expected_draft_revision: draftRevision,
              expected_published_version_id: publishedVersionId,
            }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          graph?: FlowVersionGraph;
          flow?: FlowRow;
        };
        if (response.status === 409) {
          await reloadDraft();
          throw new Error(
            payload.error ??
              "The draft changed before restore. Review the refreshed draft and retry.",
          );
        }
        if (!response.ok || !payload.graph) {
          throw new Error(
            payload.error ?? `Restore failed: ${response.status}`,
          );
        }
        setStateRaw((current) =>
          applyRestoredVersion(current, payload.graph!),
        );
        if (payload.flow) {
          setDraftRevision(payload.flow.draft_revision);
          setPublishedVersionId(payload.flow.published_version_id);
        }
        setDirty(false);
        toast.success(
          "Version restored to the draft. Publish when you are ready to make it live.",
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Version restore failed",
        );
      } finally {
        setActivating(false);
      }
    },
    [draftRevision, initialFlow.id, publishedVersionId, reloadDraft],
  );

  // ---- Delete ----
  const deleteFlow = useCallback(async () => {
    const yes = window.confirm(
      `Delete "${state.name}"? Any active runs end immediately. This can't be undone.`,
    );
    if (!yes) return;
    try {
      const res = await fetch(`/api/flows/${initialFlow.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      router.push("/flows");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast.error(msg);
    }
  }, [initialFlow.id, router, state.name]);

  // ---- Node mutations ----
  const updateNode = useCallback(
    (key: string, patch: Partial<BuilderNode>) => {
      setState((s) => ({
        ...s,
        nodes: s.nodes.map((n) =>
          n.node_key === key ? { ...n, ...patch } : n,
        ),
      }));
    },
    [setState],
  );

  const updateNodeConfig = useCallback(
    (key: string, configPatch: Record<string, unknown>) => {
      setState((s) => ({
        ...s,
        nodes: s.nodes.map((n) =>
          n.node_key === key ? applyNodeConfigPatch(n, configPatch) : n,
        ),
      }));
    },
    [setState],
  );

  const updateNodePosition = useCallback(
    (key: string, x: number, y: number) => {
      setState((s) => ({
        ...s,
        nodes: s.nodes.map((n) =>
          n.node_key === key
            ? { ...n, position_x: Math.round(x), position_y: Math.round(y) }
            : n,
        ),
      }));
    },
    [setState],
  );

  const updateNodePositions = useCallback(
    (positions: Record<string, { x: number; y: number }>) => {
      // Initial Dagre layout hydration should not dirty the editor:
      // opening a legacy all-zero flow must not enable Save or arm
      // beforeunload before the user actually edits anything.
      setStateRaw((s) => ({
        ...s,
        nodes: applyNodePositions(s.nodes, positions),
      }));
    },
    [],
  );

  const addNode = useCallback(
    (type: NodeType): string => {
      const meta = NODE_META[type];
      const base = slugify(meta.label, type);
      let createdKey = base;
      setState((s) => {
        const node_key = uniqueNodeKey(base, s.nodes);
        createdKey = node_key;
        const next: BuilderNode = {
          node_key,
          node_type: type,
          config: defaultConfigFor(type),
        };
        return {
          ...s,
          nodes: [...s.nodes, next],
          // If this is the first node and it's a start, pick it as
          // the entry automatically. Saves a click.
          entry_node_id:
            s.entry_node_id ??
            (type === "start" ? node_key : s.entry_node_id ?? null),
        };
      });
      return createdKey;
    },
    [setState],
  );

  const removeNode = useCallback(
    (key: string) => {
      // Auto-unlink inbound references so canvas / list deletes don't
      // leave dangling arrows behind that the validator would flag.
      // Cleared refs become "" (the "no target picked" sentinel the
      // builder forms already use).
      setState((s) => ({
        ...s,
        nodes: removeNodeAndNormalizeReferences(s.nodes, key),
        entry_node_id: s.entry_node_id === key ? null : s.entry_node_id,
      }));
    },
    [setState],
  );

  const value = useMemo<FlowEditorContextValue>(
    () => ({
      flow: initialFlow,
      state,
      setState,
      dirty,
      saving,
      activating,
      issues,
      canActivate,
      versions,
      versionsLoading,
      canManageVersions: versionControls.showControls,
      publishedVersionId,
      draftRevision,
      selectedNodeKey,
      setSelectedNodeKey,
      addNode,
      updateNode,
      updateNodeConfig,
      updateNodePosition,
      updateNodePositions,
      removeNode,
      save,
      setStatus,
      publish,
      reloadVersions,
      restoreVersion,
      deleteFlow,
      flashKey,
      requestFlash,
    }),
    [
      initialFlow,
      state,
      setState,
      dirty,
      saving,
      activating,
      issues,
      canActivate,
      versions,
      versionsLoading,
      versionControls.showControls,
      publishedVersionId,
      draftRevision,
      selectedNodeKey,
      addNode,
      updateNode,
      updateNodeConfig,
      updateNodePosition,
      updateNodePositions,
      removeNode,
      save,
      setStatus,
      publish,
      reloadVersions,
      restoreVersion,
      deleteFlow,
      flashKey,
      requestFlash,
    ],
  );

  return <FlowEditorCtx.Provider value={value}>{children}</FlowEditorCtx.Provider>;
}
