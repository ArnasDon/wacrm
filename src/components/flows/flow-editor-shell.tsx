"use client";

/**
 * View-switcher + chrome for the flow editor.
 *
 * Lays the editor out as one app-like column that fills the dashboard
 * content area (toolbar → mode row → stage → validation bar), matching
 * the Flow Builder design handoff:
 *   - A segmented Canvas / List control on the left of the mode row.
 *   - A node-type legend on the right so the canvas's per-type colors
 *     are decodable at a glance.
 *   - The active view is mounted inside a rounded "stage" that owns its
 *     own scroll/overflow, so the canvas can fill available height and
 *     the list scrolls internally.
 *
 * Why a separate component:
 *   - The page itself stays trivially small (loading + error + this).
 *   - Either view can stay unaware of the other — they share data
 *     (`{flow, nodes}`) and nothing else.
 *
 * View choice persists per-browser via localStorage so a power user
 * who prefers the list isn't fighting the default on every load.
 * Canvas is the default for everyone else — the original user
 * feedback was that the list shape made flows "hard to understand".
 */

import { useEffect, useState } from "react";
import { GitFork, List } from "lucide-react";

import { FlowBuilder } from "./flow-builder";
import { FlowCanvas } from "./flow-canvas";
import { FlowEditorProvider } from "./flow-editor-state";
import { EditorHeader } from "./header";
import { ValidationPanel } from "./validation-panel";
import { NODE_META, nodeColors, type NodeType } from "./shared";
import { cn } from "@/lib/utils";
import type { FlowRow, FlowNodeRow } from "@/lib/flows/types";
import { useTranslations } from "next-intl";

/**
 * Below this viewport width we force list view and hide the toggle.
 * Canvas with drag-to-connect on a phone is unusable — handles are
 * ~10px and live finger drags from one node to another aren't a
 * practical workflow. Matches Tailwind's `md` breakpoint.
 */
const MOBILE_BREAKPOINT = "(max-width: 767px)";

type View = "canvas" | "list";

const STORAGE_KEY = "wacrm.flowEditor.view";

// Legend covers every node type, derived from NODE_META so a new type
// can't silently go undocumented. NODE_META's key order already reads
// the way a flow flows: start → talk → capture → branch → mutate → end.
const LEGEND_TYPES = Object.keys(NODE_META) as NodeType[];

interface Props {
  initialFlow: FlowRow;
  initialNodes: FlowNodeRow[];
}

export function FlowEditorShell({ initialFlow, initialNodes }: Props) {
  const t = useTranslations("Flows.builder");

  // Read the persisted choice in the useState initializer. Safe even
  // though this is a client component because the parent page only
  // mounts us AFTER a client-side fetch resolves — there's no SSR
  // pass for this subtree, so no hydration mismatch to worry about.
  // Default to `canvas` (the new default) when nothing is saved.
  const [view, setView] = useState<View>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "canvas" || saved === "list") return saved;
    } catch {
      // Private browsing / disabled storage — fall through to default.
    }
    return "canvas";
  });

  // Live mobile detection. We don't render canvas under the
  // breakpoint regardless of `view` — but we keep `view` itself
  // intact so the user's preference comes back when they widen
  // again (e.g. rotating a tablet, resizing a window).
  const isMobile = useMatchMedia(MOBILE_BREAKPOINT);
  const effectiveView: View = isMobile ? "list" : view;

  const choose = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  return (
    <FlowEditorProvider initialFlow={initialFlow} initialNodes={initialNodes}>
      <div className="flex h-full min-h-0 flex-col">
        <EditorHeader />

        {/* ---- mode row: view toggle + node-type legend ----
            Omitted entirely on mobile (canvas is unavailable there and
            the legend is lg-only), so there's no empty band above the
            stage on small screens. */}
        {!isMobile && (
          <div className="flex items-center gap-4 px-6 py-3.5">
            <div
              role="group"
              aria-label={t("editorView")}
              className="inline-flex gap-0.5 rounded-lg border border-border bg-muted p-0.5"
            >
              <SegButton
                active={effectiveView === "canvas"}
                onClick={() => choose("canvas")}
                icon={<GitFork className="h-3.5 w-3.5" />}
                label={t("canvasView")}
              />
              <SegButton
                active={effectiveView === "list"}
                onClick={() => choose("list")}
                icon={<List className="h-3.5 w-3.5" />}
                label={t("listView")}
              />
            </div>
            <div className="ml-auto hidden flex-wrap items-center gap-x-3.5 gap-y-1.5 lg:flex">
              {LEGEND_TYPES.map((t_type) => (
                <span
                  key={t_type}
                  className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: nodeColors(t_type).solid }}
                  />
                  {t(`nodes.${t_type}.label`)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ---- stage: the active view, owning its own overflow ---- */}
        <div className="relative mx-6 min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card-2">
          {effectiveView === "canvas" ? (
            <FlowCanvas />
          ) : (
            <div className="absolute inset-0 overflow-y-auto">
              <FlowBuilder />
            </div>
          )}
        </div>

        {/* ---- validation / activate-readiness bar ---- */}
        <div className="px-6 pb-5 pt-3">
          <ValidationPanel />
        </div>
      </div>
    </FlowEditorProvider>
  );
}

/**
 * Tiny `useMatchMedia` shim. We could pull in `react-responsive` but
 * this is the only consumer and matchMedia is one of those browser
 * APIs that doesn't need a dependency.
 */
function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Safari < 14 still uses addListener; addEventListener is the
    // modern path. Both fire identically.
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function SegButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
