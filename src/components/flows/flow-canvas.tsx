'use client';

/**
 * Canvas / mind-map view of a flow. Editable, in parity with the
 * list view for everything except the trigger / header / fallback
 * panels (those are list-only — they don't fit visually inside a
 * node graph and the user can switch to List for them).
 *
 * What this view does:
 *   - Renders every flow_node as a draggable tile, pan + zoom +
 *     minimap. Drag positions persist via the editor context
 *     (writing on dragStop, not every frame).
 *   - Renders edges between nodes, labeled per slot (button title,
 *     "true" / "false", list row title) so a branching flow reads
 *     as a real decision tree.
 *   - Click a node → side-sheet opens with the same per-node form
 *     the list view uses, plus "Set as entry" / "Delete".
 *   - Drag from a source handle on one node to a target handle on
 *     another → wires that slot's `next_node_key`. Per-slot handles
 *     for multi-outgoing types (condition, send_buttons, send_list)
 *     so the user picks which branch they're wiring.
 *   - Backspace / Delete on a selected node → removes it AND clears
 *     every inbound `next_node_key` reference (no dangling arrows).
 *   - Delete on a selected edge → clears just that slot.
 *   - "+ Add node" floating button drops a new node at the visible
 *     viewport center.
 *   - Runs dagre auto-layout once on mount for flows whose
 *     `position_x` / `position_y` are all zero (pre-canvas flows
 *     and brand-new flows) — otherwise everything would pile at
 *     the origin.
 *
 * The toggle in `flow-editor-shell.tsx` swaps this in for
 * `<FlowBuilder>` on the same page. Both views share the same
 * `BuilderState` via `useFlowEditor()` — toggling never resets
 * unsaved edits, and a drag here updates the same nodes array the
 * list view reads.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Node as RfNode,
  type Edge as RfEdge,
  type NodeChange,
  type NodeProps,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Trash2 } from 'lucide-react';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  applyEdgeConnection,
  deriveCanvasEdges,
  outgoingSlots,
} from '@/lib/flows/edges';
import { autoLayout, shouldAutoLayout } from '@/lib/flows/layout';
import {
  NODE_META,
  NodeIconChip,
  groupNodeTypesByCategory,
  nodeColors,
  summarizeNode,
  type BuilderNode,
  type NodeType,
} from './shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useFlowEditor } from './flow-editor-state';
import { NodeConfigForm } from './forms/node-config-form';

// React-Flow node `data` payload — the bits our custom renderer needs.
interface NodeData extends Record<string, unknown> {
  node: BuilderNode;
  isEntry: boolean;
  /** Validator's "look here" pulse — flashes the card border for
   *  ~1.6s. Drives a CSS animation, doesn't change layout. */
  isFlashed: boolean;
}

const NODE_WIDTH = 240;
// Best-effort default; actual height varies by summary length but
// dagre needs SOMETHING to compute rank spacing. Underestimating is
// safer than over (tighter layout that still doesn't overlap).
const NODE_HEIGHT = 90;

// ============================================================
// Custom node — one card per flow node, styled to match the list
// view's collapsed card so the two views feel like the same product.
// ============================================================

// Echo the design's green/red branch ports for the condition node's
// true / false slots; every other slot inherits the node's own hue.
// The true/false hues are derived from the start (emerald) and handoff
// (rose) node colors so all branch/port colors stay single-sourced in
// NODE_HUE — a palette tweak there can't leave these stale.
function slotColor(nodeType: NodeType, slotId: string, fallback: string) {
  if (nodeType === 'condition' && slotId === 'true') {
    return nodeColors('start').solid;
  }
  if (nodeType === 'condition' && slotId === 'false') {
    return nodeColors('handoff').solid;
  }
  return fallback;
}

function FlowNodeCard({ data, selected }: NodeProps) {
  const t = useTranslations('Flows.builder');
  const { node, isEntry, isFlashed } = data as NodeData;
  const meta = NODE_META[node.node_type];
  const c = nodeColors(node.node_type);
  const tSummary = useTranslations('Flows.summary');
  const summary = summarizeNode(node, tSummary);
  const slots = outgoingSlots(node);
  // Start nodes are entry-only; nothing ever targets them, so they
  // don't need an incoming Handle. Every other node type accepts
  // incoming edges (including terminal handoff / end — they're the
  // common targets).
  const hasTarget = node.node_type !== 'start';
  // Single-slot nodes get a single source handle floated on the right
  // edge of the card. Multi-slot nodes (condition, send_buttons,
  // send_list) render slot rows inline so each handle visually sits
  // next to the slot it represents.
  const isMultiSlot = slots.length > 1;
  return (
    <div
      style={
        {
          '--nc': c.solid,
          '--nc-soft': c.soft,
          '--nc-ring': c.ring,
          '--nc-text': c.text,
          borderColor: selected ? c.solid : undefined,
          boxShadow: selected
            ? `0 0 0 1px ${c.solid}, 0 14px 36px -12px ${c.ring}`
            : undefined,
        } as React.CSSProperties
      }
      className={cn(
        'bg-card relative max-w-[260px] min-w-[220px] rounded-xl border px-3.5 py-3 text-left shadow-[0_2px_6px_rgba(0,0,0,0.18)] transition-[box-shadow,border-color]',
        selected
          ? 'border-[var(--nc)]'
          : 'border-border hover:border-[var(--nc-ring)]',
        // Flash overrides hover/selected colors briefly. Tailwind's
        // built-in `animate-pulse` is too gentle; a ring with the
        // amber accent matches the list view's flash semantics.
        isFlashed && '!border-amber-400 ring-2 ring-amber-400/60'
      )}
    >
      {hasTarget && (
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-card !h-2.5 !w-2.5 !border-2 !border-[var(--nc-ring)]"
        />
      )}

      <div className="flex items-center gap-2">
        <NodeIconChip
          type={node.node_type}
          size={24}
          iconSize={14}
          className="rounded-md"
        />
        <span
          className="truncate text-[10.5px] font-semibold tracking-wider uppercase"
          style={{ color: c.text }}
        >
          {t(`nodes.${node.node_type}.label`)}
        </span>
        {isEntry && (
          <span className="border-border text-muted-foreground ml-auto rounded border px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.1em] uppercase">
            {t('badgeEntry')}
          </span>
        )}
      </div>
      <div className="text-muted-foreground mt-2 truncate font-mono text-[11px]">
        {node.node_key}
      </div>
      {summary && (
        <div className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
          {summary}
        </div>
      )}

      {isMultiSlot && (
        <div className="border-border mt-2.5 flex flex-col gap-1 border-t pt-2.5">
          {slots.map((slot) => (
            <div
              key={slot.id}
              className="text-muted-foreground relative flex items-center justify-between gap-2 rounded px-1 py-0.5 text-[11px]"
            >
              <span className="truncate" title={slot.label}>
                {slot.label}
              </span>
              <Handle
                type="source"
                id={slot.id}
                position={Position.Right}
                style={{
                  borderColor: slotColor(node.node_type, slot.id, c.solid),
                }}
                // Override default absolute positioning so the handle
                // sits flush with the right edge of the card instead
                // of floating at vertical center. The negative offset
                // matches the card's px-3 + the handle's own radius.
                className="!bg-card !relative !top-auto !right-auto !h-2.5 !w-2.5 !translate-x-[14px] !transform-none !border-2"
              />
            </div>
          ))}
        </div>
      )}

      {!isMultiSlot && slots.length === 1 && (
        <Handle
          type="source"
          id={slots[0].id}
          position={Position.Right}
          style={{ borderColor: c.solid }}
          className="!bg-card !h-2.5 !w-2.5 !border-2"
        />
      )}
    </div>
  );
}

const NODE_TYPES = { flow: FlowNodeCard };

// ============================================================
// Root canvas
// ============================================================

/**
 * Outer wrapper provides the React-Flow context to the inner body,
 * so `useReactFlow()` works from anywhere in `FlowCanvasInner`
 * (notably, the pan-to-flash effect). The split is required because
 * useReactFlow() must be called inside a ReactFlowProvider.
 */
export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}

function FlowCanvasInner() {
  const t = useTranslations('Flows.builder');
  const {
    state,
    setState,
    updateNodeConfig,
    updateNodePosition,
    updateNodePositions,
    removeNode,
    flashKey,
  } = useFlowEditor();
  const reactFlow = useReactFlow();
  const builderNodes = state.nodes;
  const entryNodeId = state.entry_node_id;

  // Side-panel state — which node's form is open. Canvas-only UI; the
  // list view's analogue is the per-card expanded set in
  // flow-builder.tsx.
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const selectedNode = useMemo(
    () =>
      selectedNodeKey
        ? (builderNodes.find((n) => n.node_key === selectedNodeKey) ?? null)
        : null,
    [selectedNodeKey, builderNodes]
  );

  const autoLayoutPositions = useMemo(() => {
    const canvasEdges = deriveCanvasEdges(builderNodes);

    return shouldAutoLayout(builderNodes)
      ? autoLayout(
          builderNodes.map((n) => ({
            id: n.node_key,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
          })),
          canvasEdges.map((e) => ({ source: e.source, target: e.target })),
          { direction: 'TB' }
        )
      : null;
  }, [builderNodes]);

  // If dagre had to place an all-zero flow, persist the generated
  // positions into editor state once. Otherwise the next drag would
  // save only the dragged node and every other node would fall back
  // to (0,0), which feels like nodes teleporting around the canvas.
  const persistedAutoLayoutRef = useRef(false);
  useEffect(() => {
    if (!autoLayoutPositions || persistedAutoLayoutRef.current) return;
    persistedAutoLayoutRef.current = true;
    updateNodePositions(
      Object.fromEntries(
        [...autoLayoutPositions].map(([key, pos]) => [key, pos])
      )
    );
  }, [autoLayoutPositions, updateNodePositions]);

  const derivedRfNodes = useMemo(() => {
    const nodes: RfNode<NodeData>[] = builderNodes.map((n) => {
      const fallback = autoLayoutPositions?.get(n.node_key);
      return {
        id: n.node_key,
        type: 'flow',
        position: {
          x: fallback?.x ?? n.position_x ?? 0,
          y: fallback?.y ?? n.position_y ?? 0,
        },
        data: {
          node: n,
          isEntry: n.node_key === entryNodeId,
          isFlashed: n.node_key === flashKey,
        },
      };
    });

    return nodes;
  }, [builderNodes, entryNodeId, flashKey, autoLayoutPositions]);

  const [rfNodes, setRfNodes] = useState<RfNode<NodeData>[]>(derivedRfNodes);

  useEffect(() => {
    setRfNodes(derivedRfNodes);
  }, [derivedRfNodes]);

  const rfEdges = useMemo(() => {
    const canvasEdges = deriveCanvasEdges(builderNodes);

    // sourceHandle is now wired up — the FlowNodeCard renders a Handle
    // per slot whose id matches the scheme in edges.ts, so React-Flow
    // can hang the arrow off the right place on each card.
    const rfEdges: RfEdge[] = canvasEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      label: e.label,
      // Mode-aware via CSS tokens so edge chrome flips with light/dark.
      labelStyle: { fill: 'var(--muted-foreground)', fontSize: 11 },
      labelBgStyle: { fill: 'var(--card)' },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      style: { stroke: 'var(--border)', strokeWidth: 1.5 },
    }));

    return rfEdges;
  }, [builderNodes]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<RfNode<NodeData>>[]) => {
      setRfNodes((nodes) => applyNodeChanges(changes, nodes));
    },
    []
  );

  // Drag-to-position: React-Flow tracks the visual drag internally and
  // fires this once on release. We write the final coordinate back to
  // the editor context (which flips `dirty`); save then ships the new
  // positions in the existing PUT /api/flows/[id] body (the route
  // already destructures position_x / position_y per migration 010).
  // Writing only on dragStop (not on every position-change tick during
  // the drag) keeps state updates cheap on long drags.
  const handleNodeDragStop = useCallback<OnNodeDrag<RfNode<NodeData>>>(
    (_event, node) => {
      updateNodePosition(node.id, node.position.x, node.position.y);
    },
    [updateNodePosition]
  );

  // Pan to the flashed node when the validator panel requests one.
  // Animate over 400ms; landing zoom is whatever the user already has
  // (don't force a zoom reset — that would be jarring mid-edit).
  useEffect(() => {
    if (!flashKey) return;
    const node = builderNodes.find((n) => n.node_key === flashKey);
    if (!node) return;
    const x = (node.position_x ?? 0) + NODE_WIDTH / 2;
    const y = (node.position_y ?? 0) + NODE_HEIGHT / 2;
    reactFlow.setCenter(x, y, {
      zoom: reactFlow.getZoom(),
      duration: 400,
    });
  }, [flashKey, builderNodes, reactFlow]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: RfNode<NodeData>) => {
      setSelectedNodeKey(node.id);
    },
    []
  );

  // Drag-to-connect: React-Flow fires onConnect when the user drops a
  // handle drag onto a target handle. We look up the source node,
  // compute the right config patch via applyEdgeConnection (matches
  // the same slot scheme as deriveCanvasEdges), and dispatch via
  // updateNodeConfig. The resulting state change re-derives edges on
  // the next render — no need to maintain a separate edge list.
  const handleConnect = useCallback(
    (connection: Connection) => {
      if (
        !connection.source ||
        !connection.target ||
        !connection.sourceHandle
      ) {
        return;
      }
      const sourceNode = builderNodes.find(
        (n) => n.node_key === connection.source
      );
      if (!sourceNode) return;
      // Self-loops are a footgun (a button whose target is its own
      // node = infinite reprompt). Reject silently — the user can
      // still wire one via the per-node dropdown if they really want.
      if (connection.source === connection.target) return;
      const patch = applyEdgeConnection(
        sourceNode,
        connection.sourceHandle,
        connection.target
      );
      if (patch) updateNodeConfig(connection.source, patch);
    },
    [builderNodes, updateNodeConfig]
  );

  // Keyboard delete (Backspace / Delete) + drag-to-trash. React-Flow
  // fires this with the set of deleted-node objects; we route each
  // through the editor context's removeNode (which now also unlinks
  // inbound references so no dangling arrows survive). Closing the
  // side panel on delete keeps the UI honest if the user deleted the
  // node currently being edited.
  const handleNodesDelete = useCallback(
    (deleted: RfNode<NodeData>[]) => {
      for (const n of deleted) {
        removeNode(n.id);
        if (selectedNodeKey === n.id) setSelectedNodeKey(null);
      }
    },
    [removeNode, selectedNodeKey]
  );

  // Edge delete: clear the source node's slot rather than removing
  // anything. Edges are derived from configs, so the only way to
  // "delete" one is to null out its underlying next_node_key.
  const handleEdgesDelete = useCallback(
    (deleted: RfEdge[]) => {
      for (const e of deleted) {
        if (!e.sourceHandle) continue;
        const sourceNode = builderNodes.find((n) => n.node_key === e.source);
        if (!sourceNode) continue;
        const patch = applyEdgeConnection(sourceNode, e.sourceHandle, '');
        if (patch) updateNodeConfig(e.source, patch);
      }
    },
    [builderNodes, updateNodeConfig]
  );

  // Wrapped mutators that target the currently-selected node — pass to
  // the form so each keystroke goes through the editor context (which
  // flips `dirty` and feeds the validator).
  const onSelectedUpdateConfig = useCallback(
    (patch: Record<string, unknown>) => {
      if (selectedNodeKey) updateNodeConfig(selectedNodeKey, patch);
    },
    [selectedNodeKey, updateNodeConfig]
  );

  const handleDeleteSelected = useCallback(() => {
    if (!selectedNodeKey) return;
    removeNode(selectedNodeKey);
    setSelectedNodeKey(null);
  }, [selectedNodeKey, removeNode]);

  const handleSetEntry = useCallback(() => {
    if (!selectedNodeKey) return;
    setState((s) => ({ ...s, entry_node_id: selectedNodeKey }));
  }, [selectedNodeKey, setState]);

  if (rfNodes.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 text-sm">
        <p>{t('noNodesYet')}</p>
        <CanvasAddNodeButton t={t} />
      </div>
    );
  }

  return (
    <>
      <div className="h-full w-full overflow-hidden">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          proOptions={{ hideAttribution: true }}
          onNodesChange={handleNodesChange}
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={handleNodeClick}
          onConnect={handleConnect}
          onNodesDelete={handleNodesDelete}
          onEdgesDelete={handleEdgesDelete}
          // Default is "Backspace" only — accept both so Mac users
          // hitting Delete (Fn+Backspace) get the same behavior.
          deleteKeyCode={['Backspace', 'Delete']}
          nodesConnectable={true}
          edgesFocusable={true}
          elementsSelectable={true}
          // Lower default min/max zoom than the lib's defaults; the
          // tiles already truncate their summary at a reasonable
          // size, so we don't need to zoom past 1.5x.
          minZoom={0.2}
          maxZoom={1.5}
        >
          {/* Dot grid, matching the design's faint canvas backdrop. */}
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1.4}
            color="var(--border)"
          />
          <Controls
            className="!border-border !bg-card [&_button]:!border-border [&_button]:!bg-card [&_button:hover]:!bg-muted [&_button_svg]:!fill-foreground !overflow-hidden !rounded-xl !border !shadow-[0_6px_20px_-8px_rgba(0,0,0,0.5)]"
            showInteractive={false}
          />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) =>
              nodeColors((n.data as NodeData).node.node_type).solid
            }
            nodeStrokeWidth={0}
            nodeBorderRadius={3}
            maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
            className="!border-border !bg-card !rounded-xl !border !shadow-[0_6px_20px_-8px_rgba(0,0,0,0.5)]"
          />
          <Panel position="top-left" className="!top-4 !left-4">
            <CanvasAddNodeButton t={t} />
          </Panel>
        </ReactFlow>
      </div>

      <NodeEditSheet
        node={selectedNode}
        isEntry={selectedNode?.node_key === entryNodeId}
        allNodes={builderNodes}
        onClose={() => setSelectedNodeKey(null)}
        onUpdateConfig={onSelectedUpdateConfig}
        onDelete={handleDeleteSelected}
        onSetEntry={handleSetEntry}
        t={t}
      />
    </>
  );
}

// ============================================================
// Side panel — opens when a canvas node is clicked. Mounts the
// shared NodeConfigForm dispatcher so edits made here behave
// identically to the list view's per-card editor.
// ============================================================

function NodeEditSheet({
  node,
  isEntry,
  allNodes,
  onClose,
  onUpdateConfig,
  onDelete,
  onSetEntry,
  t,
}: {
  node: BuilderNode | null;
  isEntry: boolean;
  allNodes: BuilderNode[];
  onClose: () => void;
  onUpdateConfig: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onSetEntry: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  // Sheet is controlled — opens when a node is selected, closes via
  // Esc / overlay / close button (all delegated to onClose).
  const open = node !== null;
  if (!node) {
    return (
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-md" />
      </Sheet>
    );
  }
  const meta = NODE_META[node.node_type];
  const c = nodeColors(node.node_type);
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="border-border bg-popover flex w-full flex-col gap-0 border-l p-0 sm:max-w-md"
      >
        <SheetHeader className="border-border flex-row items-center gap-3 space-y-0 border-b px-5 py-4">
          <NodeIconChip type={node.node_type} size={36} iconSize={18} />
          <div className="min-w-0 flex-1">
            <SheetTitle className="flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase">
              <span style={{ color: c.text }}>{t(`nodes.${node.node_type}.label`)}</span>
              {isEntry && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-emerald-300 uppercase">
                  {t('badgeEntry')}
                </span>
              )}
            </SheetTitle>
            <SheetDescription className="text-muted-foreground mt-0.5 text-xs">
              {t(`nodes.${node.node_type}.blurb`)}
            </SheetDescription>
          </div>
          <code className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
            {node.node_key}
          </code>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <NodeConfigForm
            node={node}
            allNodes={allNodes}
            showAdvanced={false}
            onUpdateConfig={onUpdateConfig}
          />
        </div>

        <SheetFooter className="border-border border-t px-5 py-3 sm:flex-row sm:justify-between">
          {!isEntry ? (
            <Button variant="ghost" size="sm" onClick={onSetEntry}>
              {t('setAsEntry')}
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('deleteNode')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ============================================================
// Floating add-node button — bottom-right of the canvas. Mirrors
// the list view's AddNodeButton (same dropdown menu, same NodeType
// list, same icons via NODE_META) but drops the new node into the
// center of the visible viewport rather than appending to a list.
// ============================================================

const ADD_NODE_TYPES: NodeType[] = [
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

function CanvasAddNodeButton({ t }: { t: ReturnType<typeof useTranslations> }) {
  const reactFlow = useReactFlow();
  const { addNode, updateNodePosition } = useFlowEditor();

  const handleAdd = (type: NodeType) => {
    const key = addNode(type);
    // Place the new node at the visible canvas center. The Panel's
    // own DOM lives inside ReactFlow so we can climb up to find the
    // .react-flow root and read its bounding rect. If we can't find
    // it (test envs, etc.), addNode's default (0, 0) is the fallback
    // and the user can drag the node into view.
    const root = document.querySelector('.react-flow') as HTMLElement | null;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const center = reactFlow.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    // NODE_WIDTH / NODE_HEIGHT are the dagre layout defaults; offset
    // so the card sits visually centered rather than top-left at the
    // viewport center.
    updateNodePosition(
      key,
      center.x - NODE_WIDTH / 2,
      center.y - NODE_HEIGHT / 2
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium shadow-[0_6px_20px_-8px_rgba(0,0,0,0.5)] transition-colors"
        aria-label={t('addNode')}
      >
        <Plus className="h-4 w-4" />
        {t('addNode')}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="border-border bg-popover w-[268px] p-1.5"
      >
        {groupNodeTypesByCategory(ADD_NODE_TYPES).map((group, i) => (
          // DropdownMenuGroup (base-ui Menu.Group) is REQUIRED: the
          // DropdownMenuLabel below is base-ui's Menu.GroupLabel, which
          // throws at render without a Menu.Group ancestor. A plain <div>
          // here crashed the page when this menu opened (issue #336).
          <Fragment key={group.id}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground px-2 py-1.5 text-[11px] font-semibold tracking-wider uppercase">
                {t(`categories.${group.id}`)}
              </DropdownMenuLabel>
              {group.types.map((t_type) => {
                const meta = NODE_META[t_type];
                return (
                  <DropdownMenuItem
                    key={t_type}
                    onClick={() => handleAdd(t_type)}
                    className="gap-3 py-2"
                  >
                    <NodeIconChip
                      type={t_type}
                      size={28}
                      iconSize={16}
                      className="rounded-md"
                    />
                    <span className="flex flex-col">
                      <span className="text-popover-foreground text-[13px] font-semibold">
                        {t(`nodes.${t_type}.label`)}
                      </span>
                      <span className="text-muted-foreground text-[11.5px]">
                        {t(`nodes.${t_type}.blurb`)}
                      </span>
                    </span>
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
