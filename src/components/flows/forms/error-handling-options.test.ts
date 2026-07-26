import { describe, expect, it } from 'vitest';

import { errorHandlingOptionsForNode } from './error-handling-options';

describe('errorHandlingOptionsForNode', () => {
  it('offers default_value for a single deterministic success edge', () => {
    expect(
      errorHandlingOptionsForNode('send_message', {
        text: 'Hello',
        next_node_key: 'end',
      })
    ).toContain('default_value');
  });

  it.each([
    ['condition', { true_next: 'yes', false_next: 'no' }],
    [
      'send_buttons',
      {
        buttons: [{ next_node_key: 'yes' }, { next_node_key: 'no' }],
      },
    ],
    [
      'send_list',
      {
        sections: [
          {
            rows: [{ next_node_key: 'one' }, { next_node_key: 'two' }],
          },
        ],
      },
    ],
    ['handoff', {}],
  ])(
    'hides default_value for non-deterministic %s configs',
    (nodeType, config) => {
      expect(errorHandlingOptionsForNode(nodeType, config)).not.toContain(
        'default_value'
      );
    }
  );
});
