import { describe, it, expect } from 'vitest';
import {
  applyNodePositions,
  defaultConfigFor,
  uniqueNodeKey,
} from './flow-editor-state';
import type { BuilderNode, NodeType } from './shared';

describe('uniqueNodeKey', () => {
  it("returns the base key when it isn't taken", () => {
    expect(uniqueNodeKey('menu', [])).toBe('menu');
    expect(
      uniqueNodeKey('menu', [
        { node_key: 'other', node_type: 'end', config: {} },
      ])
    ).toBe('menu');
  });

  it('appends _2 when the base is taken', () => {
    expect(
      uniqueNodeKey('menu', [
        { node_key: 'menu', node_type: 'end', config: {} },
      ])
    ).toBe('menu_2');
  });

  it('walks forward until it finds an unused suffix', () => {
    const existing: BuilderNode[] = [
      { node_key: 'menu', node_type: 'end', config: {} },
      { node_key: 'menu_2', node_type: 'end', config: {} },
      { node_key: 'menu_3', node_type: 'end', config: {} },
    ];
    expect(uniqueNodeKey('menu', existing)).toBe('menu_4');
  });
});

describe('applyNodePositions', () => {
  it('rounds and applies positions without changing unrelated nodes', () => {
    const nodes: BuilderNode[] = [
      {
        node_key: 'start',
        node_type: 'start',
        config: {},
        position_x: 0,
        position_y: 0,
      },
      {
        node_key: 'message',
        node_type: 'send_message',
        config: {},
        position_x: 10,
        position_y: 20,
      },
    ];

    expect(
      applyNodePositions(nodes, {
        start: { x: 10.4, y: 20.6 },
      })
    ).toEqual([
      {
        node_key: 'start',
        node_type: 'start',
        config: {},
        position_x: 10,
        position_y: 21,
      },
      {
        node_key: 'message',
        node_type: 'send_message',
        config: {},
        position_x: 10,
        position_y: 20,
      },
    ]);
  });
});

describe('defaultConfigFor', () => {
  // The hook's addNode and the validator both depend on these defaults
  // being self-consistent. A broken default would surface as a
  // validation error on a freshly-added node, which is exactly what
  // these snapshots guard against.
  const types: NodeType[] = [
    'start',
    'send_message',
    'send_buttons',
    'send_list',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'end',
  ];

  it('returns an object for every known node type', () => {
    for (const t of types) {
      expect(typeof defaultConfigFor(t)).toBe('object');
    }
  });

  it('send_buttons default has at least one button row', () => {
    const cfg = defaultConfigFor('send_buttons') as {
      buttons?: Array<{ reply_id: string; title: string }>;
    };
    expect(cfg.buttons?.length).toBeGreaterThan(0);
    expect(cfg.buttons?.[0].reply_id).toBeTruthy();
  });

  it('send_list default has at least one section with one row', () => {
    const cfg = defaultConfigFor('send_list') as {
      sections?: Array<{ rows: unknown[] }>;
    };
    expect(cfg.sections?.length).toBeGreaterThan(0);
    expect(cfg.sections?.[0].rows.length).toBeGreaterThan(0);
  });

  it('send_media defaults to image (the most common case)', () => {
    const cfg = defaultConfigFor('send_media') as { media_type?: string };
    expect(cfg.media_type).toBe('image');
  });

  it('collect_input ships a valid var_key that passes the validator regex', () => {
    const cfg = defaultConfigFor('collect_input') as { var_key?: string };
    // Mirrors the regex in validate.ts: alphanumeric + underscore,
    // starts with letter or underscore.
    expect(cfg.var_key).toMatch(/^[a-zA-Z_][a-zA-Z0-9_]*$/);
  });

  it("end's default is an empty object (terminal — no config)", () => {
    expect(defaultConfigFor('end')).toEqual({});
  });
});
