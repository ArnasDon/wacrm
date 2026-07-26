import { describe, expect, it } from 'vitest';

import type { NodePortDescriptor } from './registry';
import {
  arePortTypesCompatible,
  validateCanvasConnection,
  validatePortConnection,
} from './connection-validation';

const nodes = [
  {
    node_key: 'message',
    node_type: 'send_message',
    config: { text: 'Hello', next_node_key: '' },
  },
  {
    node_key: 'end',
    node_type: 'end',
    config: {},
  },
] as const;

describe('typed flow port compatibility', () => {
  it.each([
    ['string', 'string', true],
    ['string', 'any', true],
    ['any', 'json', true],
    ['number', 'string', false],
    ['control', 'string', false],
    ['control', 'any', false],
    ['control', 'control', true],
  ] as const)('matches %s to %s as %s', (source, target, expected) => {
    expect(arePortTypesCompatible(source, target)).toBe(expected);
  });

  it('accepts a compatible legacy control connection', () => {
    expect(
      validateCanvasConnection(
        {
          source: 'message',
          target: 'end',
          sourceHandle: 'next',
          targetHandle: null,
        },
        nodes,
        []
      )
    ).toEqual({ valid: true });
  });

  it('rejects self edges', () => {
    expect(
      validateCanvasConnection(
        {
          source: 'message',
          target: 'message',
          sourceHandle: 'next',
          targetHandle: 'in',
        },
        nodes,
        []
      )
    ).toMatchObject({ valid: false, reason: 'self_edge' });
  });

  it('rejects duplicate edges', () => {
    expect(
      validateCanvasConnection(
        {
          source: 'message',
          target: 'end',
          sourceHandle: 'next',
          targetHandle: 'in',
        },
        nodes,
        [
          {
            source: 'message',
            target: 'end',
            sourceHandle: 'next',
          },
        ]
      )
    ).toMatchObject({ valid: false, reason: 'duplicate' });
  });

  it('enforces source cardinality', () => {
    const targetNodes = [
      ...nodes,
      { node_key: 'other_end', node_type: 'end', config: {} },
    ];

    expect(
      validateCanvasConnection(
        {
          source: 'message',
          target: 'other_end',
          sourceHandle: 'next',
          targetHandle: 'in',
        },
        targetNodes,
        [
          {
            source: 'message',
            target: 'end',
            sourceHandle: 'next',
          },
        ]
      )
    ).toMatchObject({ valid: false, reason: 'source_cardinality' });
  });

  it('enforces target cardinality for typed data ports', () => {
    const oneInput: NodePortDescriptor = {
      id: 'value',
      label: 'Value',
      type: 'string',
      cardinality: 'one',
    };

    expect(
      validatePortConnection(
        {
          source: 'source_b',
          target: 'target',
          sourceHandle: 'value',
          targetHandle: 'value',
        },
        [
          {
            source: 'source_a',
            target: 'target',
            sourceHandle: 'value',
            targetHandle: 'value',
          },
        ],
        {
          id: 'value',
          label: 'Value',
          type: 'string',
          cardinality: 'many',
        },
        oneInput
      )
    ).toMatchObject({ valid: false, reason: 'target_cardinality' });
  });

  it('rejects incompatible typed ports', () => {
    expect(
      validatePortConnection(
        {
          source: 'source',
          target: 'target',
          sourceHandle: 'amount',
          targetHandle: 'name',
        },
        [],
        {
          id: 'amount',
          label: 'Amount',
          type: 'number',
          cardinality: 'one',
        },
        {
          id: 'name',
          label: 'Name',
          type: 'string',
          cardinality: 'many',
        }
      )
    ).toMatchObject({ valid: false, reason: 'incompatible_types' });
  });

  it('rejects unknown handles instead of silently treating them as control', () => {
    expect(
      validateCanvasConnection(
        {
          source: 'message',
          target: 'end',
          sourceHandle: 'unknown',
          targetHandle: 'in',
        },
        nodes,
        []
      )
    ).toMatchObject({ valid: false, reason: 'unknown_source_port' });
  });

  it('uses real runtime descriptor data ports and their cardinality', () => {
    const runtimeNodes = [
      { node_key: 'collect', node_type: 'collect_input' },
      { node_key: 'set', node_type: 'variable_set' },
      { node_key: 'http', node_type: 'http_request' },
    ];

    expect(
      validateCanvasConnection(
        {
          source: 'collect',
          target: 'set',
          sourceHandle: 'value',
          targetHandle: 'value',
        },
        runtimeNodes,
        []
      )
    ).toEqual({ valid: true });
    expect(
      validateCanvasConnection(
        {
          source: 'collect',
          target: 'http',
          sourceHandle: 'value',
          targetHandle: 'request',
        },
        runtimeNodes,
        []
      )
    ).toMatchObject({ valid: false, reason: 'incompatible_types' });
    expect(
      validateCanvasConnection(
        {
          source: 'http',
          target: 'set',
          sourceHandle: 'response',
          targetHandle: 'value',
        },
        runtimeNodes,
        [
          {
            source: 'collect',
            target: 'set',
            sourceHandle: 'value',
            targetHandle: 'value',
          },
        ]
      )
    ).toMatchObject({ valid: false, reason: 'target_cardinality' });
  });
});
