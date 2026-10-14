import { describe, it, expect } from 'vitest';
import {
  applyEdgeConnection,
  deriveCanvasEdges,
  outgoingSlots,
  unlinkNodeReferences,
} from './edges';
import type { BuilderNode } from '@/components/flows/shared';

function nodes(...ns: BuilderNode[]): BuilderNode[] {
  return ns;
}

describe('deriveCanvasEdges — single-outgoing node types', () => {
  it('derives a `next` edge from send_message', () => {
    const edges = deriveCanvasEdges(
      nodes(
        {
          node_key: 'a',
          node_type: 'send_message',
          config: { text: 'hi', next_node_key: 'b' },
        },
        { node_key: 'b', node_type: 'end', config: {} }
      )
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: 'a',
      target: 'b',
      sourceHandle: 'next',
    });
  });

  it('derives a `next` edge from send_media, set_tag, collect_input, start', () => {
    const edges = deriveCanvasEdges(
      nodes(
        { node_key: 's', node_type: 'start', config: { next_node_key: 'm' } },
        {
          node_key: 'm',
          node_type: 'send_media',
          config: {
            media_type: 'image',
            media_url: 'https://x/y.png',
            next_node_key: 't',
          },
        },
        {
          node_key: 't',
          node_type: 'set_tag',
          config: { mode: 'add', tag_id: 'u', next_node_key: 'ci' },
        },
        {
          node_key: 'ci',
          node_type: 'collect_input',
          config: {
            prompt_text: 'p',
            var_key: 'v',
            next_node_key: 'e',
          },
        },
        { node_key: 'e', node_type: 'end', config: {} }
      )
    );
    expect(edges).toHaveLength(4);
    expect(edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      's->m',
      'm->t',
      't->ci',
      'ci->e',
    ]);
  });

  it('skips dangling edges (next_node_key pointing nowhere)', () => {
    const edges = deriveCanvasEdges(
      nodes({
        node_key: 'a',
        node_type: 'send_message',
        config: { text: 'hi', next_node_key: 'ghost' },
      })
    );
    expect(edges).toEqual([]);
  });

  it('skips empty next_node_key (fresh node)', () => {
    const edges = deriveCanvasEdges(
      nodes({
        node_key: 'a',
        node_type: 'send_message',
        config: { text: 'hi', next_node_key: '' },
      })
    );
    expect(edges).toEqual([]);
  });
});

describe('deriveCanvasEdges — condition (true/false branches)', () => {
  it('produces a labeled edge for each branch', () => {
    const edges = deriveCanvasEdges(
      nodes(
        {
          node_key: 'c',
          node_type: 'condition',
          config: {
            subject: 'var',
            subject_key: 'x',
            operator: 'equals',
            value: 'y',
            true_next: 't',
            false_next: 'f',
          },
        },
        { node_key: 't', node_type: 'end', config: {} },
        { node_key: 'f', node_type: 'end', config: {} }
      )
    );
    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.sourceHandle === 'true')).toMatchObject({
      target: 't',
      label: 'true',
    });
    expect(edges.find((e) => e.sourceHandle === 'false')).toMatchObject({
      target: 'f',
      label: 'false',
    });
  });

  it('emits whichever branches are set when one points nowhere', () => {
    const edges = deriveCanvasEdges(
      nodes(
        {
          node_key: 'c',
          node_type: 'condition',
          config: {
            subject: 'var',
            subject_key: 'x',
            operator: 'present',
            true_next: 't',
            false_next: '',
          },
        },
        { node_key: 't', node_type: 'end', config: {} }
      )
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].sourceHandle).toBe('true');
  });
});

describe('deriveCanvasEdges — send_buttons (per-button)', () => {
  it('emits one edge per button, labeled with the button title', () => {
    const edges = deriveCanvasEdges(
      nodes(
        {
          node_key: 'menu',
          node_type: 'send_buttons',
          config: {
            text: 'Pick',
            buttons: [
              { reply_id: 'yes', title: 'Yes', next_node_key: 'ok' },
              { reply_id: 'no', title: 'No', next_node_key: 'bye' },
            ],
          },
        },
        { node_key: 'ok', node_type: 'handoff', config: {} },
        { node_key: 'bye', node_type: 'end', config: {} }
      )
    );
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({
      source: 'menu',
      target: 'ok',
      sourceHandle: 'button:yes',
      label: 'Yes',
    });
    expect(edges[1]).toMatchObject({
      source: 'menu',
      target: 'bye',
      sourceHandle: 'button:no',
      label: 'No',
    });
  });

  it('falls back to reply_id when title is missing', () => {
    const edges = deriveCanvasEdges(
      nodes(
        {
          node_key: 'm',
          node_type: 'send_buttons',
          config: {
            text: 'x',
            buttons: [{ reply_id: 'raw', next_node_key: 'e' }],
          },
        },
        { node_key: 'e', node_type: 'end', config: {} }
      )
    );
    expect(edges[0].label).toBe('raw');
  });

  it("skips buttons whose target doesn't exist", () => {
    const edges = deriveCanvasEdges(
      nodes(
        {
          node_key: 'm',
          node_type: 'send_buttons',
          config: {
            text: 'x',
            buttons: [
              { reply_id: 'good', title: 'G', next_node_key: 'real' },
              { reply_id: 'bad', title: 'B', next_node_key: 'ghost' },
            ],
          },
        },
        { node_key: 'real', node_type: 'end', config: {} }
      )
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].sourceHandle).toBe('button:good');
  });
});

describe('deriveCanvasEdges — send_list (per-row across sections)', () => {
  it('emits one edge per row, with `row:<reply_id>` handles', () => {
    const edges = deriveCanvasEdges(
      nodes(
        {
          node_key: 'list',
          node_type: 'send_list',
          config: {
            text: 'Pick',
            button_label: 'View',
            sections: [
              {
                title: 'Recent',
                rows: [
                  { reply_id: 'o1', title: 'Order 1', next_node_key: 'a' },
                ],
              },
              {
                title: 'Older',
                rows: [
                  { reply_id: 'o2', title: 'Order 2', next_node_key: 'b' },
                ],
              },
            ],
          },
        },
        { node_key: 'a', node_type: 'handoff', config: {} },
        { node_key: 'b', node_type: 'handoff', config: {} }
      )
    );
    expect(edges).toHaveLength(2);
    expect(edges[0].sourceHandle).toBe('row:o1');
    expect(edges[0].label).toBe('Order 1');
    expect(edges[1].sourceHandle).toBe('row:o2');
  });
});

describe('deriveCanvasEdges — terminal nodes', () => {
  it('emits no outgoing edges from handoff / end', () => {
    const edges = deriveCanvasEdges(
      nodes(
        { node_key: 'h', node_type: 'handoff', config: { note: 'x' } },
        { node_key: 'e', node_type: 'end', config: {} }
      )
    );
    expect(edges).toEqual([]);
  });
});

describe('deriveCanvasEdges — id stability', () => {
  it('produces unique, deterministic ids per (source, slot, target)', () => {
    const edges = deriveCanvasEdges(
      nodes(
        {
          node_key: 'm',
          node_type: 'send_buttons',
          config: {
            text: 'x',
            buttons: [
              { reply_id: 'a', title: 'A', next_node_key: 'x' },
              { reply_id: 'b', title: 'B', next_node_key: 'x' },
            ],
          },
        },
        { node_key: 'x', node_type: 'end', config: {} }
      )
    );
    const ids = edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('outgoingSlots', () => {
  it("returns a single 'next' slot for the auto-advancing types", () => {
    const each = (node: BuilderNode) => outgoingSlots(node).map((s) => s.id);
    expect(
      each({
        node_key: 'x',
        node_type: 'start',
        config: { next_node_key: 'y' },
      })
    ).toEqual(['next']);
    expect(
      each({ node_key: 'x', node_type: 'send_message', config: {} })
    ).toEqual(['next']);
    expect(
      each({ node_key: 'x', node_type: 'send_media', config: {} })
    ).toEqual(['next']);
    expect(
      each({ node_key: 'x', node_type: 'collect_input', config: {} })
    ).toEqual(['next']);
    expect(each({ node_key: 'x', node_type: 'set_tag', config: {} })).toEqual([
      'next',
    ]);
  });

  it('returns true/false slots for condition', () => {
    const slots = outgoingSlots({
      node_key: 'c',
      node_type: 'condition',
      config: {},
    });
    expect(slots.map((s) => s.id)).toEqual(['true', 'false']);
    expect(slots.map((s) => s.label)).toEqual(['true', 'false']);
  });

  it('returns one slot per button, labelled with the title', () => {
    const slots = outgoingSlots({
      node_key: 'm',
      node_type: 'send_buttons',
      config: {
        text: 'Pick',
        buttons: [
          { reply_id: 'yes', title: 'Yes', next_node_key: '' },
          { reply_id: 'no', title: 'No', next_node_key: '' },
        ],
      },
    });
    expect(slots).toEqual([
      { id: 'button:yes', label: 'Yes' },
      { id: 'button:no', label: 'No' },
    ]);
  });

  it('falls back to reply_id for buttons with no title', () => {
    const slots = outgoingSlots({
      node_key: 'm',
      node_type: 'send_buttons',
      config: {
        text: 'x',
        buttons: [{ reply_id: 'raw', next_node_key: '' }],
      },
    });
    expect(slots[0].label).toBe('raw');
  });

  it('flattens list rows across all sections', () => {
    const slots = outgoingSlots({
      node_key: 'l',
      node_type: 'send_list',
      config: {
        text: 'Pick',
        button_label: 'View',
        sections: [
          { rows: [{ reply_id: 'o1', title: 'Order 1', next_node_key: '' }] },
          { rows: [{ reply_id: 'o2', title: 'Order 2', next_node_key: '' }] },
        ],
      },
    });
    expect(slots.map((s) => s.id)).toEqual(['row:o1', 'row:o2']);
  });

  it('terminal nodes (handoff / end) have no outgoing slots', () => {
    expect(
      outgoingSlots({ node_key: 'h', node_type: 'handoff', config: {} })
    ).toEqual([]);
    expect(
      outgoingSlots({ node_key: 'e', node_type: 'end', config: {} })
    ).toEqual([]);
  });
});

describe('applyEdgeConnection', () => {
  it('patches next_node_key for single-outgoing nodes', () => {
    const node: BuilderNode = {
      node_key: 'a',
      node_type: 'send_message',
      config: { text: 'hi', next_node_key: '' },
    };
    expect(applyEdgeConnection(node, 'next', 'b')).toEqual({
      next_node_key: 'b',
    });
  });

  it("returns null when the source handle isn't recognised on the type", () => {
    const node: BuilderNode = {
      node_key: 'a',
      node_type: 'send_message',
      config: {},
    };
    expect(applyEdgeConnection(node, 'true', 'b')).toBeNull();
    expect(applyEdgeConnection(node, 'button:x', 'b')).toBeNull();
  });

  it('patches the right branch on a condition', () => {
    const node: BuilderNode = {
      node_key: 'c',
      node_type: 'condition',
      config: {
        subject: 'var',
        subject_key: 'x',
        operator: 'equals',
        value: 'y',
        true_next: '',
        false_next: '',
      },
    };
    expect(applyEdgeConnection(node, 'true', 't')).toEqual({ true_next: 't' });
    expect(applyEdgeConnection(node, 'false', 'f')).toEqual({
      false_next: 'f',
    });
  });

  it('patches only the matching button row on send_buttons', () => {
    const node: BuilderNode = {
      node_key: 'm',
      node_type: 'send_buttons',
      config: {
        text: 'Pick',
        buttons: [
          { reply_id: 'yes', title: 'Yes', next_node_key: '' },
          { reply_id: 'no', title: 'No', next_node_key: '' },
        ],
      },
    };
    const patch = applyEdgeConnection(node, 'button:yes', 'ok');
    expect(patch).toEqual({
      buttons: [
        { reply_id: 'yes', title: 'Yes', next_node_key: 'ok' },
        { reply_id: 'no', title: 'No', next_node_key: '' },
      ],
    });
  });

  it("returns null when the button reply_id doesn't exist on the node", () => {
    const node: BuilderNode = {
      node_key: 'm',
      node_type: 'send_buttons',
      config: {
        text: 'x',
        buttons: [{ reply_id: 'a', title: 'A', next_node_key: '' }],
      },
    };
    expect(applyEdgeConnection(node, 'button:ghost', 'z')).toBeNull();
  });

  it('patches the matching list row across sections', () => {
    const node: BuilderNode = {
      node_key: 'l',
      node_type: 'send_list',
      config: {
        text: 'x',
        button_label: 'View',
        sections: [
          { rows: [{ reply_id: 'o1', title: 'O1', next_node_key: '' }] },
          { rows: [{ reply_id: 'o2', title: 'O2', next_node_key: '' }] },
        ],
      },
    };
    const patch = applyEdgeConnection(node, 'row:o2', 'tgt') as {
      sections: Array<{ rows: Array<{ next_node_key: string }> }>;
    };
    expect(patch.sections[0].rows[0].next_node_key).toBe('');
    expect(patch.sections[1].rows[0].next_node_key).toBe('tgt');
  });

  it('returns null for terminal nodes (no outgoing)', () => {
    expect(
      applyEdgeConnection(
        { node_key: 'h', node_type: 'handoff', config: {} },
        'next',
        'x'
      )
    ).toBeNull();
    expect(
      applyEdgeConnection(
        { node_key: 'e', node_type: 'end', config: {} },
        'next',
        'x'
      )
    ).toBeNull();
  });
});

describe('unlinkNodeReferences', () => {
  it('clears next_node_key when it points at the deleted node', () => {
    const before: BuilderNode[] = [
      {
        node_key: 'a',
        node_type: 'send_message',
        config: { text: 'hi', next_node_key: 'victim' },
      },
      { node_key: 'victim', node_type: 'end', config: {} },
    ];
    const after = unlinkNodeReferences(before, 'victim');
    expect((after[0].config as { next_node_key: string }).next_node_key).toBe(
      ''
    );
  });

  it('clears both true_next and false_next when condition points at the deleted node', () => {
    const before: BuilderNode[] = [
      {
        node_key: 'c',
        node_type: 'condition',
        config: {
          true_next: 'victim',
          false_next: 'victim',
        },
      },
    ];
    const after = unlinkNodeReferences(before, 'victim');
    const cfg = after[0].config as {
      true_next: string;
      false_next: string;
    };
    expect(cfg.true_next).toBe('');
    expect(cfg.false_next).toBe('');
  });

  it('clears only the buttons that point at the deleted node', () => {
    const before: BuilderNode[] = [
      {
        node_key: 'm',
        node_type: 'send_buttons',
        config: {
          text: 'x',
          buttons: [
            { reply_id: 'a', title: 'A', next_node_key: 'victim' },
            { reply_id: 'b', title: 'B', next_node_key: 'safe' },
          ],
        },
      },
    ];
    const after = unlinkNodeReferences(before, 'victim');
    const buttons = (
      after[0].config as {
        buttons: Array<{ reply_id: string; next_node_key: string }>;
      }
    ).buttons;
    expect(buttons[0].next_node_key).toBe('');
    expect(buttons[1].next_node_key).toBe('safe');
  });

  it('clears only the list rows that point at the deleted node', () => {
    const before: BuilderNode[] = [
      {
        node_key: 'l',
        node_type: 'send_list',
        config: {
          sections: [
            {
              rows: [
                { reply_id: 'r1', next_node_key: 'victim' },
                { reply_id: 'r2', next_node_key: 'safe' },
              ],
            },
          ],
        },
      },
    ];
    const after = unlinkNodeReferences(before, 'victim');
    const rows = (
      after[0].config as {
        sections: Array<{ rows: Array<{ next_node_key: string }> }>;
      }
    ).sections[0].rows;
    expect(rows[0].next_node_key).toBe('');
    expect(rows[1].next_node_key).toBe('safe');
  });

  it('returns the input nodes by identity when none reference the deleted key (no-op path)', () => {
    const nodes: BuilderNode[] = [
      {
        node_key: 'a',
        node_type: 'send_message',
        config: { text: 'hi', next_node_key: 'b' },
      },
      { node_key: 'b', node_type: 'end', config: {} },
    ];
    const after = unlinkNodeReferences(nodes, 'ghost');
    // Same array length, each entry === input (no clone).
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(nodes[0]);
    expect(after[1]).toBe(nodes[1]);
  });
});
