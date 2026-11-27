import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  applyTagIds,
  buildFlowExport,
  collectTagNames,
  parseFlowImport,
} from './import';
import { validateFlowForActivation } from './validate';

const minimal = {
  name: 'Mini',
  trigger_type: 'keyword',
  trigger_config: { keywords: ['hi'], match_type: 'exact' },
  nodes: [
    { node_key: 'start', node_type: 'start', config: { next_node_key: 'end' } },
    { node_key: 'end', node_type: 'end', config: {} },
  ],
};

describe('parseFlowImport', () => {
  it('accepts a minimal flow and defaults entry to the start node', () => {
    const r = parseFlowImport(minimal);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.entry_node_id).toBe('start');
      expect(r.value.fallback_policy.on_unknown_reply).toBe('reprompt');
      expect(r.value.nodes[0].position_x).toBe(0);
    }
  });

  it('accepts the wrapped { flow } form and entry_node_key alias', () => {
    const r = parseFlowImport({ flow: { ...minimal, entry_node_key: 'end' } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.entry_node_id).toBe('end');
  });

  it('rejects non-objects, missing name and empty nodes', () => {
    expect(parseFlowImport(null).ok).toBe(false);
    expect(parseFlowImport({ ...minimal, name: ' ' }).ok).toBe(false);
    expect(parseFlowImport({ ...minimal, nodes: [] }).ok).toBe(false);
  });

  it('rejects unknown node types, bad keys and duplicates', () => {
    const bad = (nodes: unknown[]) => parseFlowImport({ ...minimal, nodes });
    expect(bad([{ node_key: 'a', node_type: 'nope', config: {} }]).ok).toBe(false);
    expect(bad([{ node_key: 'bad key!', node_type: 'end', config: {} }]).ok).toBe(false);
    expect(
      bad([
        { node_key: 'a', node_type: 'end', config: {} },
        { node_key: 'a', node_type: 'end', config: {} },
      ]).ok,
    ).toBe(false);
  });

  it('rejects an unknown trigger type', () => {
    expect(parseFlowImport({ ...minimal, trigger_type: 'cron' }).ok).toBe(false);
  });
});

describe('tag name handling', () => {
  const nodes = [
    { node_key: 't', node_type: 'set_tag' as const, config: { mode: 'add', tag_name: 'refund', next_node_key: 'end' }, position_x: 0, position_y: 0 },
    { node_key: 'end', node_type: 'end' as const, config: {}, position_x: 0, position_y: 0 },
  ];

  it('collects names and swaps them for ids', () => {
    expect(collectTagNames(nodes)).toEqual(['refund']);
    const out = applyTagIds(nodes, new Map([['refund', 'uuid-1']]));
    expect(out[0].config).toEqual({ mode: 'add', tag_id: 'uuid-1', next_node_key: 'end' });
  });

  it('export turns tag_id back into tag_name (round trip)', () => {
    const doc = buildFlowExport(
      { name: 'x', description: null, trigger_type: 'manual', trigger_config: {}, fallback_policy: {}, entry_node_id: 't' },
      [{ node_key: 't', node_type: 'set_tag', config: { mode: 'add', tag_id: 'uuid-1', next_node_key: 'end' } }],
      new Map([['uuid-1', 'refund']]),
    );
    expect(doc.nodes[0].config).toEqual({ mode: 'add', tag_name: 'refund', next_node_key: 'end' });
  });
});

describe('shipped example: Online Onward Tickets flow', () => {
  const raw = readFileSync(
    join(process.cwd(), 'docs/examples/online-onward-tickets.wacrm-flow.json'),
    'utf8',
  );
  const parsed = parseFlowImport(JSON.parse(raw));

  it('parses', () => {
    expect(parsed.ok).toBe(true);
  });

  it('has no validation errors or unreachable nodes once tags are resolved', () => {
    if (!parsed.ok) throw new Error('did not parse');
    const ids = new Map(collectTagNames(parsed.value.nodes).map((n) => [n, `id-${n}`]));
    const nodes = applyTagIds(parsed.value.nodes, ids);
    const issues = validateFlowForActivation(
      {
        name: parsed.value.name,
        trigger_type: parsed.value.trigger_type,
        trigger_config: parsed.value.trigger_config,
        entry_node_id: parsed.value.entry_node_id,
      },
      nodes,
    );
    expect(issues).toEqual([]);
  });
});
