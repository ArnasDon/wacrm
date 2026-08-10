import { describe, expect, it } from 'vitest';

import {
  renderTemplateBody,
  resolveTemplateBodyParams,
} from './template-render';

describe('renderTemplateBody', () => {
  it('substitutes positional {{N}} placeholders', () => {
    expect(
      renderTemplateBody('Hi {{1}}, your order {{2}} shipped.', [
        'Jane',
        'A123',
      ])
    ).toBe('Hi Jane, your order A123 shipped.');
  });

  it('leaves a placeholder intact when no value was supplied', () => {
    // Blanking it would silently drop text and read as a truncated
    // message; leaving it makes the missing value obvious.
    expect(renderTemplateBody('Date: {{3}} Time: {{7}}', ['a', 'b', 'c'])).toBe(
      'Date: c Time: {{7}}'
    );
  });

  it('reuses a value when the same placeholder repeats', () => {
    expect(renderTemplateBody('{{1}} and {{1}} again', ['x'])).toBe(
      'x and x again'
    );
  });

  it('returns a body with no placeholders unchanged', () => {
    expect(renderTemplateBody('No variables here.', [])).toBe(
      'No variables here.'
    );
  });
});

describe('resolveTemplateBodyParams', () => {
  it('prefers structured messageParams.body', () => {
    expect(resolveTemplateBodyParams({ body: ['a', 'b'] }, ['legacy'])).toEqual(
      ['a', 'b']
    );
  });

  it('falls back to the legacy positional array', () => {
    expect(resolveTemplateBodyParams(undefined, ['legacy'])).toEqual([
      'legacy',
    ]);
    expect(resolveTemplateBodyParams({ headerText: 'h' }, ['legacy'])).toEqual([
      'legacy',
    ]);
  });

  it('returns an empty array when neither shape carries values', () => {
    expect(resolveTemplateBodyParams(null, undefined)).toEqual([]);
    expect(resolveTemplateBodyParams('not-an-object', undefined)).toEqual([]);
  });
});
