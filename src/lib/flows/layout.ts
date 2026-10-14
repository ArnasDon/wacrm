/**
 * Dagre-based auto-layout for the flow canvas.
 *
 * The canvas reads `flow_nodes.position_x` / `position_y` (added in
 * migration 010 as `INTEGER NOT NULL DEFAULT 0` — reserved precisely
 * for this view). Brand-new flows and every flow authored before the
 * canvas shipped have all-zero positions, which would render as a
 * single overlapping pile at the origin. This module computes
 * reasonable starting positions in those cases.
 *
 * Why dagre over a hand-rolled BFS layout: branches with multiple
 * outgoing edges (send_buttons, condition, send_list) need horizontal
 * spread to be readable, and dagre's `rank`+`order` pass handles edge
 * crossings far better than anything we'd write by hand. ~30 KB gz
 * for the standalone wrapper, but the canvas already pulls in
 * @xyflow/react so this is incremental.
 *
 * What we do NOT do here: re-layout on every edit. The canvas
 * persists the user's drag positions, and we only ever auto-layout
 * once when `shouldAutoLayout()` returns true. Otherwise a user who
 * carefully arranged a flow would have their work overwritten on
 * reload.
 */

import Dagre from '@dagrejs/dagre';

export interface LayoutNode {
  id: string;
  /** Optional measured size — falls back to defaults if not provided. */
  width?: number;
  height?: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

export interface LayoutOptions {
  /** Top-to-bottom is the natural reading order for conversation flows. */
  direction?: 'TB' | 'LR';
  /** Gap between rows (TB) / columns (LR). */
  rankSep?: number;
  /** Gap between sibling nodes within the same rank. */
  nodeSep?: number;
  /** Default node width when a node's width isn't measured yet. */
  defaultWidth?: number;
  /** Default node height when a node's height isn't measured yet. */
  defaultHeight?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  direction: 'TB',
  rankSep: 80,
  nodeSep: 60,
  defaultWidth: 240,
  defaultHeight: 90,
};

/**
 * True iff every node sits at the origin — the signal that no human
 * has positioned this flow yet and auto-layout is safe to run.
 *
 * Why `every`, not `some`: a partially-laid-out flow (some nodes at
 * 0,0, others positioned) is almost certainly mid-edit. Re-running
 * dagre would shuffle the positioned ones the user already chose.
 * Better to leave the new nodes at 0,0 and let the user drag them.
 */
export function shouldAutoLayout(
  nodes: Array<{ position_x?: number | null; position_y?: number | null }>
): boolean {
  if (nodes.length === 0) return false;
  return nodes.every(
    (n) => (n.position_x ?? 0) === 0 && (n.position_y ?? 0) === 0
  );
}

/**
 * Compute positions for every node id. Returns a map keyed by node
 * id; consumers merge it into their React-Flow nodes array. The
 * returned coordinates are the TOP-LEFT corner (matches React-Flow's
 * coordinate space — dagre internally tracks centers, we translate).
 */
export function autoLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {}
): Map<string, LayoutPosition> {
  const opts = { ...DEFAULTS, ...options };
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: opts.direction,
    ranksep: opts.rankSep,
    nodesep: opts.nodeSep,
  });

  for (const n of nodes) {
    g.setNode(n.id, {
      width: n.width ?? opts.defaultWidth,
      height: n.height ?? opts.defaultHeight,
    });
  }
  for (const e of edges) {
    // Dagre tolerates edges to/from non-existent nodes by inserting
    // them as zero-size — that would silently warp the layout. Skip
    // dangling edges instead; the canvas's edge derivation already
    // filters them but defending here keeps this helper standalone.
    if (g.node(e.source) && g.node(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  Dagre.layout(g);

  const positions = new Map<string, LayoutPosition>();
  for (const n of nodes) {
    const laid = g.node(n.id);
    if (!laid) continue;
    // Dagre returns the center; React-Flow wants the top-left.
    positions.set(n.id, {
      x: laid.x - (n.width ?? opts.defaultWidth) / 2,
      y: laid.y - (n.height ?? opts.defaultHeight) / 2,
    });
  }
  return positions;
}
