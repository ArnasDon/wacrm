/**
 * Derive canvas edges from the flow's node list.
 *
 * Edges live INSIDE each node's `config` JSONB (each button row /
 * list row / condition branch carries its own `next_node_key`). The
 * canvas needs them as a separate `{ source, target, label,
 * sourceHandle }` list to render arrows, and the labels need to be
 * meaningful — a `send_buttons` node with three buttons isn't useful
 * on the canvas if the three outgoing arrows are unlabeled.
 *
 * Why this lives in lib/flows (not next to flow-canvas.tsx): the
 * derivation is pure data manipulation with no React-Flow types in
 * it, which makes it (a) trivially unit-testable and (b) reusable by
 * the editable canvas (PR 2) without dragging in client-only deps.
 *
 * `sourceHandle` ids are stable strings the canvas wires up to its
 * per-node renderer's outgoing connection points. They match the
 * scheme PR 2's drag-to-connect handler will read:
 *   - `next`            for single-outgoing nodes
 *   - `button:<reply_id>` for send_buttons rows
 *   - `row:<reply_id>`    for send_list rows
 *   - `true` / `false`    for condition branches
 */

import type { BuilderNode } from '@/components/flows/shared';

export interface CanvasEdge {
  /** Stable per-edge id — required by React-Flow. */
  id: string;
  /** node_key of the source node. */
  source: string;
  /** node_key of the target node. */
  target: string;
  /** Identifies which outgoing slot on the source node this edge belongs to. */
  sourceHandle: string;
  /** Human-readable label rendered on the canvas (e.g. "Yes button"). */
  label?: string;
}

export function deriveCanvasEdges(nodes: BuilderNode[]): CanvasEdge[] {
  const knownKeys = new Set(nodes.map((n) => n.node_key));
  const edges: CanvasEdge[] = [];

  for (const node of nodes) {
    const cfg = node.config;
    switch (node.node_type) {
      case 'start':
      case 'send_message':
      case 'send_media':
      case 'collect_input':
      case 'set_tag': {
        const next = (cfg as { next_node_key?: string }).next_node_key;
        if (next && knownKeys.has(next)) {
          edges.push({
            id: `${node.node_key}--next--${next}`,
            source: node.node_key,
            target: next,
            sourceHandle: 'next',
          });
        }
        break;
      }

      case 'condition': {
        const trueNext = (cfg as { true_next?: string }).true_next;
        const falseNext = (cfg as { false_next?: string }).false_next;
        if (trueNext && knownKeys.has(trueNext)) {
          edges.push({
            id: `${node.node_key}--true--${trueNext}`,
            source: node.node_key,
            target: trueNext,
            sourceHandle: 'true',
            label: 'true',
          });
        }
        if (falseNext && knownKeys.has(falseNext)) {
          edges.push({
            id: `${node.node_key}--false--${falseNext}`,
            source: node.node_key,
            target: falseNext,
            sourceHandle: 'false',
            label: 'false',
          });
        }
        break;
      }

      case 'send_buttons': {
        const buttons = Array.isArray((cfg as { buttons?: unknown }).buttons)
          ? (cfg as { buttons: Array<Record<string, unknown>> }).buttons
          : [];
        for (const btn of buttons) {
          const replyId =
            typeof btn.reply_id === 'string' ? btn.reply_id : null;
          const next =
            typeof btn.next_node_key === 'string' ? btn.next_node_key : null;
          const title = typeof btn.title === 'string' ? btn.title : null;
          if (!replyId || !next || !knownKeys.has(next)) continue;
          edges.push({
            id: `${node.node_key}--button:${replyId}--${next}`,
            source: node.node_key,
            target: next,
            sourceHandle: `button:${replyId}`,
            label: title ?? replyId,
          });
        }
        break;
      }

      case 'send_list': {
        const sections = Array.isArray((cfg as { sections?: unknown }).sections)
          ? (cfg as { sections: Array<Record<string, unknown>> }).sections
          : [];
        for (const section of sections) {
          const rows = Array.isArray(section.rows)
            ? (section.rows as Array<Record<string, unknown>>)
            : [];
          for (const row of rows) {
            const replyId =
              typeof row.reply_id === 'string' ? row.reply_id : null;
            const next =
              typeof row.next_node_key === 'string' ? row.next_node_key : null;
            const title = typeof row.title === 'string' ? row.title : null;
            if (!replyId || !next || !knownKeys.has(next)) continue;
            edges.push({
              id: `${node.node_key}--row:${replyId}--${next}`,
              source: node.node_key,
              target: next,
              sourceHandle: `row:${replyId}`,
              label: title ?? replyId,
            });
          }
        }
        break;
      }

      case 'handoff':
      case 'end':
        // Terminal nodes — no outgoing edges.
        break;
    }
  }

  return edges;
}

// ============================================================
// Inverse operations — used by the canvas's drag-to-connect and
// delete-with-cleanup handlers (PR 2b). Kept in lib/flows so the
// canvas component stays free of edge-bookkeeping logic.
// ============================================================

/**
 * Outgoing-slot list for a node — used by the canvas to render one
 * source-side Handle per slot, labelled with the slot's user-facing
 * name. Order follows the order the slots appear in the node's
 * config so visual layout matches the form layout.
 *
 * Terminal nodes (handoff / end) return an empty list — they have
 * no outgoing edges and no source handles.
 */
export interface OutgoingSlot {
  /** Stable id matching the `sourceHandle` scheme used in
   *  CanvasEdge. */
  id: string;
  /** Visible label rendered next to the handle. */
  label: string;
}

export function outgoingSlots(node: BuilderNode): OutgoingSlot[] {
  const cfg = node.config;
  switch (node.node_type) {
    case 'start':
    case 'send_message':
    case 'send_media':
    case 'collect_input':
    case 'set_tag':
      return [{ id: 'next', label: 'Next' }];

    case 'condition':
      return [
        { id: 'true', label: 'true' },
        { id: 'false', label: 'false' },
      ];

    case 'send_buttons': {
      const buttons = Array.isArray((cfg as { buttons?: unknown }).buttons)
        ? (cfg as { buttons: Array<Record<string, unknown>> }).buttons
        : [];
      return buttons
        .filter((b) => typeof b.reply_id === 'string' && b.reply_id)
        .map((b) => {
          const replyId = b.reply_id as string;
          const title = typeof b.title === 'string' ? b.title : null;
          return {
            id: `button:${replyId}`,
            label: title ?? replyId,
          };
        });
    }

    case 'send_list': {
      const sections = Array.isArray((cfg as { sections?: unknown }).sections)
        ? (cfg as { sections: Array<Record<string, unknown>> }).sections
        : [];
      const slots: OutgoingSlot[] = [];
      for (const section of sections) {
        const rows = Array.isArray(section.rows)
          ? (section.rows as Array<Record<string, unknown>>)
          : [];
        for (const row of rows) {
          const replyId =
            typeof row.reply_id === 'string' ? row.reply_id : null;
          if (!replyId) continue;
          const title = typeof row.title === 'string' ? row.title : null;
          slots.push({
            id: `row:${replyId}`,
            label: title ?? replyId,
          });
        }
      }
      return slots;
    }

    case 'handoff':
    case 'end':
      return [];
  }
}

/**
 * Compute the config patch to apply when the user drags an edge from
 * `sourceHandle` on a node to `targetKey`. Returns `null` when the
 * handle isn't recognised on the node type (defensive — React-Flow
 * would have to misroute for this to fire).
 *
 * For `send_buttons` and `send_list`, only the button/row with the
 * matching reply_id is patched; the rest of the array passes through
 * unchanged.
 */
export function applyEdgeConnection(
  node: BuilderNode,
  sourceHandle: string,
  targetKey: string
): Record<string, unknown> | null {
  switch (node.node_type) {
    case 'start':
    case 'send_message':
    case 'send_media':
    case 'collect_input':
    case 'set_tag':
      if (sourceHandle === 'next') return { next_node_key: targetKey };
      return null;

    case 'condition':
      if (sourceHandle === 'true') return { true_next: targetKey };
      if (sourceHandle === 'false') return { false_next: targetKey };
      return null;

    case 'send_buttons': {
      if (!sourceHandle.startsWith('button:')) return null;
      const replyId = sourceHandle.slice('button:'.length);
      const buttons = Array.isArray(
        (node.config as { buttons?: unknown }).buttons
      )
        ? (
            node.config as {
              buttons: Array<Record<string, unknown>>;
            }
          ).buttons
        : [];
      // No matching button → no-op (caller should have surfaced a
      // missing slot before letting the user drag).
      if (!buttons.some((b) => b.reply_id === replyId)) return null;
      return {
        buttons: buttons.map((b) =>
          b.reply_id === replyId ? { ...b, next_node_key: targetKey } : b
        ),
      };
    }

    case 'send_list': {
      if (!sourceHandle.startsWith('row:')) return null;
      const replyId = sourceHandle.slice('row:'.length);
      const sections = Array.isArray(
        (node.config as { sections?: unknown }).sections
      )
        ? (
            node.config as {
              sections: Array<Record<string, unknown>>;
            }
          ).sections
        : [];
      let matched = false;
      const next = sections.map((s) => {
        const rows = Array.isArray(s.rows)
          ? (s.rows as Array<Record<string, unknown>>)
          : [];
        return {
          ...s,
          rows: rows.map((r) => {
            if (r.reply_id === replyId) {
              matched = true;
              return { ...r, next_node_key: targetKey };
            }
            return r;
          }),
        };
      });
      return matched ? { sections: next } : null;
    }

    case 'handoff':
    case 'end':
      return null;
  }
}

/**
 * Walk every node and clear any `next_node_key` / `true_next` /
 * `false_next` / `button.next_node_key` / `row.next_node_key`
 * reference to `deletedKey`. Cleared refs become the empty string —
 * the same "no target picked" sentinel the builder forms use.
 *
 * Returns a new array; original nodes are left untouched. Nodes
 * without any matching reference pass through by identity to avoid
 * needless re-renders downstream.
 */
export function unlinkNodeReferences(
  nodes: BuilderNode[],
  deletedKey: string
): BuilderNode[] {
  return nodes.map((n) => {
    const patched = patchedConfigWithoutKey(n, deletedKey);
    return patched ? { ...n, config: patched } : n;
  });
}

function patchedConfigWithoutKey(
  node: BuilderNode,
  deletedKey: string
): Record<string, unknown> | null {
  const cfg = node.config;
  switch (node.node_type) {
    case 'start':
    case 'send_message':
    case 'send_media':
    case 'collect_input':
    case 'set_tag': {
      const next = (cfg as { next_node_key?: string }).next_node_key;
      if (next !== deletedKey) return null;
      return { ...cfg, next_node_key: '' };
    }

    case 'condition': {
      const c = cfg as { true_next?: string; false_next?: string };
      const trueMatch = c.true_next === deletedKey;
      const falseMatch = c.false_next === deletedKey;
      if (!trueMatch && !falseMatch) return null;
      return {
        ...cfg,
        ...(trueMatch ? { true_next: '' } : {}),
        ...(falseMatch ? { false_next: '' } : {}),
      };
    }

    case 'send_buttons': {
      const buttons = Array.isArray((cfg as { buttons?: unknown }).buttons)
        ? (
            cfg as {
              buttons: Array<Record<string, unknown>>;
            }
          ).buttons
        : [];
      if (!buttons.some((b) => b.next_node_key === deletedKey)) return null;
      return {
        ...cfg,
        buttons: buttons.map((b) =>
          b.next_node_key === deletedKey ? { ...b, next_node_key: '' } : b
        ),
      };
    }

    case 'send_list': {
      const sections = Array.isArray((cfg as { sections?: unknown }).sections)
        ? (
            cfg as {
              sections: Array<Record<string, unknown>>;
            }
          ).sections
        : [];
      let dirty = false;
      const next = sections.map((s) => {
        const rows = Array.isArray(s.rows)
          ? (s.rows as Array<Record<string, unknown>>)
          : [];
        return {
          ...s,
          rows: rows.map((r) => {
            if (r.next_node_key === deletedKey) {
              dirty = true;
              return { ...r, next_node_key: '' };
            }
            return r;
          }),
        };
      });
      return dirty ? { ...cfg, sections: next } : null;
    }

    case 'handoff':
    case 'end':
      return null;
  }
}
