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
import type { FlowNodeRow, FlowRow } from "@/lib/flows/types";
import { NODE_META, slugify, type BuilderNode, type NodeType } from "./shared";

// ============================================================
// State shape
// ============================================================

export interface BuilderState {
  name: string;
  description: string;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
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
  save: () => Promise<void>;
  setStatus: (status: BuilderState["status"]) => Promise<void>;
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
  switch (type) {
    case "start":
      return { next_node_key: "" };
    case "send_message":
      return { text: "", next_node_key: "" };
    case "send_buttons":
      return {
        text: "",
        buttons: [{ reply_id: "yes", title: "Yes", next_node_key: "" }],
      };
    case "send_list":
      return {
        text: "",
        button_label: "View options",
        sections: [
          {
            title: "",
            rows: [
              { reply_id: "row_1", title: "Option 1", next_node_key: "" },
            ],
          },
        ],
      };
    case "send_media":
      return {
        media_type: "image",
        media_url: "",
        caption: "",
        filename: "",
        next_node_key: "",
      };
    case "collect_input":
      return {
        prompt_text: "",
        var_key: "answer",
        next_node_key: "",
      };
    case "condition":
      return {
        subject: "var",
        subject_key: "",
        operator: "equals",
        value: "",
        true_next: "",
        false_next: "",
      };
    case "set_tag":
      return { mode: "add", tag_id: "", next_node_key: "" };
    case "handoff":
      return { note: "" };
    case "end":
      return {};
  }
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
  children: ReactNode;
}

export function FlowEditorProvider({
  initialFlow,
  initialNodes,
  children,
}: ProviderProps) {
  const router = useRouter();
  const t = useTranslations("Flows.editorState");

  const [state, setStateRaw] = useState<BuilderState>(() => ({
    name: initialFlow.name,
    description: initialFlow.description ?? "",
    trigger_type: initialFlow.trigger_type,
    trigger_config: initialFlow.trigger_config as Record<string, unknown>,
    entry_node_id: initialFlow.entry_node_id,
    status: initialFlow.status,
    nodes: initialNodes.map((n) => ({
      node_key: n.node_key,
      node_type: n.node_type as NodeType,
      config: n.config as Record<string, unknown>,
      position_x: n.position_x,
      position_y: n.position_y,
    })),
  }));

  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
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
        },
        state.nodes,
      ),
    [state],
  );
  const canActivate = useMemo(
    () => issues.every((i) => i.severity !== "error"),
    [issues],
  );

  // ---- Save (PUT) ----
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/flows/${initialFlow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name,
          description: state.description || null,
          trigger_type: state.trigger_type,
          trigger_config: state.trigger_config,
          entry_node_id: state.entry_node_id,
          nodes: state.nodes,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Save failed: ${res.status}`);
      }
      setDirty(false);
      toast.success(t("saved"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [initialFlow.id, state]);

  // ---- Activate / Pause / Archive ----
  const setStatus = useCallback(
    async (next: BuilderState["status"]) => {
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
          await save();
        }
        const res = await fetch(`/api/flows/${initialFlow.id}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? `Status update failed: ${res.status}`);
        }
        setStateRaw((s) => ({ ...s, status: next }));
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
    [canActivate, save, initialFlow.id],
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
          n.node_key === key
            ? { ...n, config: { ...n.config, ...configPatch } }
            : n,
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
        nodes: unlinkNodeReferences(
          s.nodes.filter((n) => n.node_key !== key),
          key,
        ),
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
      addNode,
      updateNode,
      updateNodeConfig,
      updateNodePosition,
      updateNodePositions,
      removeNode,
      save,
      setStatus,
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
      addNode,
      updateNode,
      updateNodeConfig,
      updateNodePosition,
      updateNodePositions,
      removeNode,
      save,
      setStatus,
      deleteFlow,
      flashKey,
      requestFlash,
    ],
  );

  return <FlowEditorCtx.Provider value={value}>{children}</FlowEditorCtx.Provider>;
}
