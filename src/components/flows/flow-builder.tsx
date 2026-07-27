"use client";

/**
 * Linear-list flow editor.
 *
 * Renders the trigger panel, entry-node picker, and the per-node card
 * list. Header and validation panel are NOT owned here — they live
 * once in FlowEditorShell so they show in both views (lifted in PR 3
 * so canvas users can also save + see validator issues).
 *
 * State lives in the shared `useFlowEditor()` context — toggling
 * Canvas ⇄ List never loses edits, and a drag on the canvas updates
 * the same nodes the list view reads.
 *
 * What's still local: the `expanded` set (which cards are open) and
 * the scroll refs used when the validator's flashKey changes — those
 * are list-only and have no canvas analogue.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { type ValidationIssue } from "@/lib/flows/validate";
import {
  NODE_META,
  NodeIconChip,
  nodeColors,
  slugify,
  summarizeNode,
  useNodeTranslations,
  type BuilderNode,
  type NodeType,
} from "./shared";
import { NodeConfigForm } from "./forms/node-config-form";
import { NodeKeySelect } from "./forms/fields";
import { IssueLine } from "./validation-panel";
import {
  useFlowEditor,
  type BuilderState,
} from "./flow-editor-state";

// ============================================================
// Local state shape — mirrors the DB but the configs are typed
// loosely (Record<string, unknown>) since each node_type carries a
// different shape. The sub-form components narrow as needed.
// ============================================================

// ============================================================
// Root component
// ============================================================

export function FlowBuilder() {
  const t = useTranslations("flows.builder");
  const {
    state,
    setState,
    issues,
    flashKey,
    addNode: addNodeCtx,
    updateNode,
    updateNodeConfig,
    removeNode: removeNodeCtx,
  } = useFlowEditor();

  // List-only UI state: which cards are expanded + scroll refs for
  // jump-to-node. The flash itself is read from context (flashKey)
  // so canvas + list share the same source of truth.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(state.nodes.map((n) => n.node_key)),
  );
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Wrap addNode so the new node opens expanded in the list view
  // (matches the previous behaviour where adding always revealed the
  // new card so the user could start editing immediately).
  const addNode = useCallback(
    (type: NodeType) => {
      const key = addNodeCtx(type);
      setExpanded((prev) => new Set([...prev, key]));
    },
    [addNodeCtx],
  );

  const removeNode = useCallback(
    (key: string) => {
      removeNodeCtx(key);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    },
    [removeNodeCtx],
  );

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const setNodeRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) nodeRefs.current.set(key, el);
      else nodeRefs.current.delete(key);
    },
    [],
  );

  // React to validator jumps via the shared flashKey. We DERIVE the
  // expanded-with-flash set (avoids the "setState inside effect"
  // smell of mutating `expanded` from a useEffect on flashKey), then
  // run a side-effect-only effect to scroll the row into view. The
  // flash class is rendered by NodeCard when its key matches
  // flashKey; the flash auto-clears in the context so no timer here.
  const expandedWithFlash = useMemo(() => {
    if (!flashKey || expanded.has(flashKey)) return expanded;
    return new Set([...expanded, flashKey]);
  }, [expanded, flashKey]);
  useEffect(() => {
    if (!flashKey) return;
    // requestAnimationFrame defers the scroll until after React has
    // committed any expand-induced layout shift.
    requestAnimationFrame(() => {
      const el = nodeRefs.current.get(flashKey);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [flashKey]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-7">
      <TriggerPanel
        state={state}
        setState={setState}
        triggerIssues={issues.filter((i) => i.scope === "trigger")}
      />

      <EntryPicker state={state} setState={setState} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {t("nodesCount", { count: state.nodes.length })}
          </h2>
          <AddNodeButton onAdd={addNode} />
        </div>

        {state.nodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: t("emptyHint") }}
          />
        ) : (
          state.nodes.map((node) => (
            <NodeCard
              key={node.node_key}
              node={node}
              allNodes={state.nodes}
              expanded={expandedWithFlash.has(node.node_key)}
              isEntry={state.entry_node_id === node.node_key}
              isFlashed={flashKey === node.node_key}
              cardRef={setNodeRef(node.node_key)}
              issues={issues.filter(
                (i) => i.scope === "node" && i.node_key === node.node_key,
              )}
              onToggle={() => toggleExpanded(node.node_key)}
              onUpdate={(patch) => updateNode(node.node_key, patch)}
              onUpdateConfig={(patch) => updateNodeConfig(node.node_key, patch)}
              onRemove={() => removeNode(node.node_key)}
              onSetEntry={() =>
                setState((s) => ({ ...s, entry_node_id: node.node_key }))
              }
            />
          ))
        )}
      </section>
    </div>
  );
}


// ============================================================
// Keyword trigger input
// ============================================================

/**
 * Comma-separated keyword entry. Keeps a local draft string so the
 * comma (and trailing space) the user types survive until they're done
 * — parsing into the keywords array on every keystroke stripped the
 * trailing comma the instant it was typed, making it impossible to
 * start a second keyword (issue #234). We commit on blur / Enter, then
 * re-display the cleaned, rejoined form. Seeded once on mount; the
 * component unmounts/remounts when the trigger type changes, so the
 * seed stays in sync. Mirrors the automations builder's KeywordMatchConfig.
 */
function KeywordsInput({
  keywords,
  onChange,
}: {
  keywords: string[];
  onChange: (keywords: string[]) => void;
}) {
  const [draft, setDraft] = useState(keywords.join(", "));

  function commit() {
    const parsed = draft
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    setDraft(parsed.join(", "));
    onChange(parsed);
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      placeholder="support, help, hi"
      className="bg-muted"
    />
  );
}

// ============================================================
// Trigger panel
// ============================================================

function TriggerPanel({
  state,
  setState,
  triggerIssues,
}: {
  state: BuilderState;
  setState: React.Dispatch<React.SetStateAction<BuilderState>>;
  triggerIssues: ValidationIssue[];
}) {
  const t = useTranslations("flows.trigger");
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{t("title")}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">{t("when")}</label>
          <Select
            value={state.trigger_type}
            onValueChange={(v) =>
              setState((s) => ({
                ...s,
                trigger_type: v as BuilderState["trigger_type"],
                trigger_config:
                  v === "keyword" ? { keywords: [] } : v === "manual" ? {} : {},
              }))
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keyword">
                {t("keyword")}
              </SelectItem>
              <SelectItem value="first_inbound_message">
                {t("firstMessage")}
              </SelectItem>
              <SelectItem value="manual">
                {t("manual")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {state.trigger_type === "keyword" && (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t("keywordsLabel")}
            </label>
            <KeywordsInput
              keywords={
                Array.isArray(state.trigger_config.keywords)
                  ? (state.trigger_config.keywords as string[])
                  : []
              }
              onChange={(keywords) =>
                setState((s) => ({
                  ...s,
                  trigger_config: { ...s.trigger_config, keywords },
                }))
              }
            />
          </div>
        )}
      </div>
      {triggerIssues.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {triggerIssues.map((i, ix) => (
            <IssueLine key={ix} issue={i} />
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================
// Entry-node picker
// ============================================================

function EntryPicker({
  state,
  setState,
}: {
  state: BuilderState;
  setState: React.Dispatch<React.SetStateAction<BuilderState>>;
}) {
  const t = useTranslations("flows.entry");
  if (state.nodes.length === 0) return null;
  return (
    <section className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <CornerDownRight className="h-4 w-4 shrink-0 text-primary" />
      <span className="text-xs text-muted-foreground">{t("label")}</span>
      <NodeKeySelect
        value={state.entry_node_id}
        nodes={state.nodes}
        onChange={(key) =>
          setState((s) => ({ ...s, entry_node_id: key }))
        }
        placeholder={t("placeholder")}
        className="flex-1 max-w-xs"
      />
    </section>
  );
}

// ============================================================
// Node card — collapsed summary + expanded config form
// ============================================================

function NodeCard({
  node,
  allNodes,
  expanded,
  isEntry,
  isFlashed,
  cardRef,
  issues,
  onToggle,
  onUpdate,
  onUpdateConfig,
  onRemove,
  onSetEntry,
}: {
  node: BuilderNode;
  allNodes: BuilderNode[];
  expanded: boolean;
  isEntry: boolean;
  isFlashed: boolean;
  cardRef: (el: HTMLDivElement | null) => void;
  issues: ValidationIssue[];
  onToggle: () => void;
  onUpdate: (patch: Partial<BuilderNode>) => void;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  onRemove: () => void;
  onSetEntry: () => void;
}) {
  const t = useTranslations("flows.builder");
  const meta = NODE_META[node.node_type];
  const c = nodeColors(node.node_type);
  const hasError = issues.some((i) => i.severity === "error");
  const preview = summarizeNode(node);
  return (
    <div
      ref={cardRef}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card transition-shadow duration-500",
        hasError
          ? "border-red-500/40"
          : isEntry
            ? "border-primary/50"
            : "border-border",
        isFlashed &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      {/* type-colored left rail, ties the list row to the canvas hue */}
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: c.solid }}
      />
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 pl-5 text-left"
      >
        <NodeIconChip type={node.node_type} size={32} iconSize={16} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="truncate text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: c.text }}
            >
              {meta.label}
            </span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {node.node_key}
            </code>
            {isEntry && (
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/10 text-[10px] text-primary"
              >
                {t("entry")}
              </Badge>
            )}
          </div>
          {!expanded && preview && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {preview}
            </p>
          )}
        </div>
        {hasError && (
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-red-400" />
        )}
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-4">
          <NodeConfigWithAdvanced
            node={node}
            allNodes={allNodes}
            onUpdate={onUpdate}
            onUpdateConfig={onUpdateConfig}
          />
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <div className="flex items-center gap-2">
              {!isEntry && (
                <Button variant="ghost" size="sm" onClick={onSetEntry}>
                  {t("setAsEntry")}
                </Button>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("removeNode")}
            </Button>
          </div>
          {issues.length > 0 && (
            <div className="mt-3 flex flex-col gap-1 rounded-md bg-red-500/5 p-2">
              {issues.map((i, ix) => (
                <IssueLine key={ix} issue={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Per-node-type config form — wraps the extracted dispatcher with
// the list-view's "Show advanced" disclosure (which exposes the
// internal node_key for stable analytics, hidden by default).
// ============================================================

function NodeConfigWithAdvanced({
  node,
  allNodes,
  onUpdate,
  onUpdateConfig,
}: {
  node: BuilderNode;
  allNodes: BuilderNode[];
  onUpdate: (patch: Partial<BuilderNode>) => void;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const t = useTranslations("flows.builder");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const hasReplyIds =
    node.node_type === "send_buttons" || node.node_type === "send_list";
  return (
    <div className="flex flex-col gap-3">
      <NodeConfigForm
        node={node}
        allNodes={allNodes}
        showAdvanced={showAdvanced}
        onUpdateConfig={onUpdateConfig}
      />
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {showAdvanced ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          <span>{showAdvanced ? t("hideAdvanced") : t("showAdvanced")}</span>
        </button>
        {showAdvanced && (
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {t("nodeKeyLabel")}
              </label>
              <Input
                value={node.node_key}
                onChange={(e) =>
                  onUpdate({ node_key: slugify(e.target.value, node.node_key) })
                }
                className="bg-muted font-mono text-xs"
              />
            </div>
            {hasReplyIds && (
              <p className="text-[10px] text-muted-foreground">
                {t("replyIdsHint")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// ============================================================
// Add-node menu
// ============================================================

function AddNodeButton({ onAdd }: { onAdd: (type: NodeType) => void }) {
  const t = useTranslations("flows.editor");
  const nt = useNodeTranslations();
  const types: NodeType[] = [
    "start",
    "send_buttons",
    "send_list",
    "send_message",
    "send_media",
    "collect_input",
    "condition",
    "set_tag",
    "handoff",
    "end",
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        aria-label={t("addNode")}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("addNode")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-border bg-popover">
        {types.map((type) => {
          const meta = NODE_META[type];
          const translated = nt[type];
          return (
            <DropdownMenuItem key={type} onClick={() => onAdd(type)}>
              <meta.icon className={cn("h-3.5 w-3.5", meta.color)} />
              {translated.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

