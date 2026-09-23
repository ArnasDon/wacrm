'use client';

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

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  CircleAlert,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  CornerDownRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { type ValidationIssue } from '@/lib/flows/validate';
import {
  NODE_META,
  NodeIconChip,
  groupNodeTypesByCategory,
  nodeColors,
  slugify,
  summarizeNode,
  type BuilderNode,
  type NodeType,
} from './shared';
import { NodeConfigForm } from './forms/node-config-form';
import { NodeKeySelect } from './forms/fields';
import { IssueLine } from './validation-panel';
import { useFlowEditor, type BuilderState } from './flow-editor-state';

// ============================================================
// Local state shape — mirrors the DB but the configs are typed
// loosely (Record<string, unknown>) since each node_type carries a
// different shape. The sub-form components narrow as needed.
// ============================================================

// ============================================================
// Root component
// ============================================================

export function FlowBuilder() {
  const t = useTranslations('Flows.builder');
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
    () => new Set(state.nodes.map((n) => n.node_key))
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
    [addNodeCtx]
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
    [removeNodeCtx]
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
    []
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
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [flashKey]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-7">
      <TriggerPanel
        state={state}
        setState={setState}
        triggerIssues={issues.filter((i) => i.scope === 'trigger')}
        t={t}
      />

      <EntryPicker state={state} setState={setState} t={t} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-foreground text-sm font-semibold">
            {t('nodesTitle', { count: state.nodes.length })}
          </h2>
          <AddNodeButton onAdd={addNode} t={t} />
        </div>

        {state.nodes.length === 0 ? (
          <div className="border-border bg-card/50 text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
            {t.rich('nodesEmpty', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </div>
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
                (i) => i.scope === 'node' && i.node_key === node.node_key
              )}
              onToggle={() => toggleExpanded(node.node_key)}
              onUpdate={(patch) => updateNode(node.node_key, patch)}
              onUpdateConfig={(patch) => updateNodeConfig(node.node_key, patch)}
              onRemove={() => removeNode(node.node_key)}
              onSetEntry={() =>
                setState((s) => ({ ...s, entry_node_id: node.node_key }))
              }
              t={t}
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
  t,
}: {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [draft, setDraft] = useState(keywords.join(', '));

  function commit() {
    const parsed = draft
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    setDraft(parsed.join(', '));
    onChange(parsed);
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      }}
      placeholder={t('keywordsPlaceholder')}
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
  t,
}: {
  state: BuilderState;
  setState: React.Dispatch<React.SetStateAction<BuilderState>>;
  triggerIssues: ValidationIssue[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <section className="border-border bg-card rounded-lg border p-4">
      <h2 className="text-foreground mb-3 text-sm font-semibold">
        {t('triggerTitle')}
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="text-muted-foreground mb-1 block text-xs">
            {t('whenLabel')}
          </label>
          <Select
            value={state.trigger_type}
            onValueChange={(v) =>
              setState((s) => ({
                ...s,
                trigger_type: v as BuilderState['trigger_type'],
                trigger_config:
                  v === 'keyword' ? { keywords: [] } : v === 'manual' ? {} : {},
              }))
            }
          >
            <SelectTrigger className="bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keyword">
                {t('triggerKeywordTitle')}
              </SelectItem>
              <SelectItem value="first_inbound_message">
                {t('triggerFirstInboundTitle')}
              </SelectItem>
              <SelectItem value="manual">{t('triggerManualTitle')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {state.trigger_type === 'keyword' && (
          <div>
            <label className="text-muted-foreground mb-1 block text-xs">
              {t('keywordsLabel')}
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
              t={t}
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
  t,
}: {
  state: BuilderState;
  setState: React.Dispatch<React.SetStateAction<BuilderState>>;
  t: ReturnType<typeof useTranslations>;
}) {
  if (state.nodes.length === 0) return null;
  return (
    <section className="border-border bg-card flex items-center gap-3 rounded-lg border p-3">
      <CornerDownRight className="text-primary h-4 w-4 shrink-0" />
      <span className="text-muted-foreground text-xs">
        {t('entryNodeTitle')}
      </span>
      <NodeKeySelect
        value={state.entry_node_id}
        nodes={state.nodes}
        onChange={(key) => setState((s) => ({ ...s, entry_node_id: key }))}
        placeholder={t('entryNodePlaceholder')}
        className="max-w-xs flex-1"
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
  t,
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
  t: ReturnType<typeof useTranslations>;
}) {
  const meta = NODE_META[node.node_type];
  const c = nodeColors(node.node_type);
  const hasError = issues.some((i) => i.severity === 'error');
  const tSummary = useTranslations('Flows.summary');
  const preview = summarizeNode(node, tSummary);
  return (
    <div
      ref={cardRef}
      className={cn(
        'bg-card relative overflow-hidden rounded-xl border transition-shadow duration-500',
        hasError
          ? 'border-red-500/40'
          : isEntry
            ? 'border-primary/50'
            : 'border-border',
        isFlashed && 'ring-primary ring-offset-background ring-2 ring-offset-2'
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
              className="truncate text-[11px] font-semibold tracking-wider uppercase"
              style={{ color: c.text }}
            >
              {t(`nodes.${node.node_type}.label`)}
            </span>
            <code className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
              {node.node_key}
            </code>
            {isEntry && (
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/10 text-primary text-[10px]"
              >
                {t('badgeEntry')}
              </Badge>
            )}
          </div>
          {!expanded && preview && (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {preview}
            </p>
          )}
        </div>
        {hasError && (
          <CircleAlert className="h-3.5 w-3.5 shrink-0 text-red-400" />
        )}
        {expanded ? (
          <ChevronUp className="text-muted-foreground h-4 w-4" />
        ) : (
          <ChevronDown className="text-muted-foreground h-4 w-4" />
        )}
      </button>
      {expanded && (
        <div className="border-border border-t px-4 py-4">
          <NodeConfigWithAdvanced
            node={node}
            allNodes={allNodes}
            onUpdate={onUpdate}
            onUpdateConfig={onUpdateConfig}
            t={t}
          />
          <div className="border-border mt-4 flex items-center justify-between border-t pt-3">
            <div className="flex items-center gap-2">
              {!isEntry && (
                <Button variant="ghost" size="sm" onClick={onSetEntry}>
                  {t('setAsEntry')}
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
              {t('removeNode')}
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
  t,
}: {
  node: BuilderNode;
  allNodes: BuilderNode[];
  onUpdate: (patch: Partial<BuilderNode>) => void;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const hasReplyIds =
    node.node_type === 'send_buttons' || node.node_type === 'send_list';
  return (
    <div className="flex flex-col gap-3">
      <NodeConfigForm
        node={node}
        allNodes={allNodes}
        showAdvanced={showAdvanced}
        onUpdateConfig={onUpdateConfig}
      />
      <div className="border-border border-t pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          {showAdvanced ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          {showAdvanced ? t('hideAdvanced') : t('showAdvanced')}
        </button>
        {showAdvanced && (
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <label className="text-muted-foreground mb-1 block text-xs">
                {t('nodeKeyLabel')}
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
              <p className="text-muted-foreground text-[10px]">
                {t('replyIdsHint')}
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

function AddNodeButton({
  onAdd,
  t,
}: {
  onAdd: (type: NodeType) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const types: NodeType[] = [
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'end',
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="border-border bg-card text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
        aria-label={t('addNode')}
      >
        <Plus className="h-3.5 w-3.5" />
        {t('addNode')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-border bg-popover">
        {groupNodeTypesByCategory(types).map((group, i) => (
          // A DropdownMenuGroup (base-ui Menu.Group) is REQUIRED here:
          // DropdownMenuLabel is base-ui's Menu.GroupLabel, which throws
          // at render if it can't find a Menu.Group ancestor context. A
          // plain <div> wrapper made opening this menu crash the page.
          <Fragment key={group.id}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                {t(`categories.${group.id}`)}
              </DropdownMenuLabel>
              {group.types.map((t_type) => {
                const meta = NODE_META[t_type];
                return (
                  <DropdownMenuItem key={t_type} onClick={() => onAdd(t_type)}>
                    <meta.icon className={cn('h-3.5 w-3.5', meta.color)} />
                    {t(`nodes.${t_type}.label`)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
