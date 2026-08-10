'use client';

/**
 * Read-only "Ver ao vivo" mode for the flow canvas — the same nodes and
 * edges the editor renders, but showing real execution data instead of
 * editing affordances: a pulsing dot on any node that ran in the last 5
 * minutes, and a 30-day execution count per node from `flow_run_events`.
 *
 * Deliberately its own component rather than a prop on `FlowCanvas`: no
 * drag, no connect, no delete, no side-effects on `useFlowEditor`'s
 * mutable state — just reads `state.nodes` from the same provider and
 * layers stats on top. Polls `/api/flows/[id]/live` every 15s; the same
 * data source (flow_run_events) already backs the run-history page, so
 * this adds zero new infrastructure.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge as RfEdge,
  type Node as RfNode,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { deriveCanvasEdges } from '@/lib/flows/edges';
import { autoLayout, shouldAutoLayout } from '@/lib/flows/layout';
import { NodeIconChip, nodeColors, summarizeNode, type BuilderNode } from './shared';
import { useFlowEditor } from './flow-editor-state';

const POLL_MS = 15_000;
const NODE_WIDTH = 240;
const NODE_HEIGHT = 90;

interface NodeStat {
  node_key: string;
  count_30d: number;
  last_event_at: string;
  live: boolean;
}

interface LiveNodeData extends Record<string, unknown> {
  node: BuilderNode;
  stat: NodeStat | null;
}

function LiveNodeCard({ data }: NodeProps) {
  const t = useTranslations('Flows.builder');
  const { node, stat } = data as LiveNodeData;
  const c = nodeColors(node.node_type);
  const summary = summarizeNode(node, t);

  return (
    <div
      className={cn(
        'relative w-[240px] rounded-xl border bg-card px-4 py-3 shadow-sm transition',
        !stat && 'opacity-60',
      )}
      style={{ borderColor: c.ring }}
    >
      {stat?.live && (
        <span className="absolute -right-1 -top-1 flex h-3 w-3" title="Actividade nos últimos 5 minutos">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
      )}
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <div className="flex items-center gap-2">
        <NodeIconChip type={node.node_type} />
        <p className="truncate text-sm font-semibold text-foreground">
          {t(`nodes.${node.node_type}.label`)}
        </p>
        <Badge variant="secondary" className="ml-auto tabular-nums">
          {stat?.count_30d ?? 0}
        </Badge>
      </div>
      {summary && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {summary}
        </p>
      )}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}

const NODE_TYPES = { liveNode: LiveNodeCard };

function FlowLiveViewInner() {
  const t = useTranslations('Flows.builder');
  const { flow, state } = useFlowEditor();
  const [stats, setStats] = useState<Record<string, NodeStat>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/flows/${flow.id}/live`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'failed to load live stats');
      const byKey: Record<string, NodeStat> = {};
      for (const row of (data.nodes ?? []) as NodeStat[]) byKey[row.node_key] = row;
      setStats(byKey);
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [flow.id]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const edges = useMemo(() => deriveCanvasEdges(state.nodes), [state.nodes]);

  const positions = useMemo(() => {
    if (!shouldAutoLayout(state.nodes)) {
      const map = new Map<string, { x: number; y: number }>();
      for (const node of state.nodes) {
        map.set(node.node_key, { x: node.position_x ?? 0, y: node.position_y ?? 0 });
      }
      return map;
    }
    return autoLayout(
      state.nodes.map((node) => ({ id: node.node_key, width: NODE_WIDTH, height: NODE_HEIGHT })),
      edges.map((edge) => ({ source: edge.source, target: edge.target })),
      { direction: 'TB' },
    );
  }, [state.nodes, edges]);

  const rfNodes: RfNode[] = state.nodes.map((node) => ({
    id: node.node_key,
    type: 'liveNode',
    data: { node, stat: stats[node.node_key] ?? null } satisfies LiveNodeData,
    position: positions.get(node.node_key) ?? { x: 0, y: 0 },
  }));

  const rfEdges: RfEdge[] = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    type: 'smoothstep',
    animated: Boolean(stats[edge.source]?.live),
    style: { stroke: 'var(--border)' },
  }));

  const selected = selectedKey ? state.nodes.find((node) => node.node_key === selectedKey) : null;
  const selectedStat = selectedKey ? stats[selectedKey] : undefined;

  return (
    <div className="relative h-full w-full">
      <div className="absolute right-3 top-3 z-10">
        <Badge variant={connected ? 'secondary' : 'outline'}>
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              connected ? 'bg-emerald-500' : 'bg-muted-foreground',
            )}
          />
          {connected ? 'Ao vivo' : 'A ligar'}
        </Badge>
      </div>

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.35}
        maxZoom={1.4}
        onNodeClick={(_, node) => setSelectedKey(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedKey(null)}>
        <SheetContent>
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{t(`nodes.${selected.node_type}.label`)}</SheetTitle>
                <SheetDescription>{summarizeNode(selected, t) ?? '—'}</SheetDescription>
              </SheetHeader>
              <div className="space-y-3 px-4">
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Execuções (30 dias)
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                    {selectedStat?.count_30d ?? 0}
                  </p>
                  {selectedStat?.last_event_at ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Última execução: {new Date(selectedStat.last_event_at).toLocaleString('pt-PT')}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sem execuções registadas nos últimos 30 dias.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function FlowLiveView() {
  return (
    <ReactFlowProvider>
      <FlowLiveViewInner />
    </ReactFlowProvider>
  );
}
