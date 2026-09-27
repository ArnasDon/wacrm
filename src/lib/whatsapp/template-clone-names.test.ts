import { describe, expect, it } from 'vitest';

import { cloneName, cloneNames, randomSuffix } from './template-clone-names';

/** Replays the given letters' positions (a=0 … z=25) as random values. */
function letters(seq: string) {
  let i = 0;
  return () => (seq.charCodeAt(i++ % seq.length) - 97) / 26 + 0.001;
}

describe('template clone names', () => {
  it('appends three random lowercase letters', () => {
    expect(randomSuffix(letters('kqm'))).toBe('kqm');
    expect(cloneName('test', new Set(), letters('abc'))).toBe('test_abc');
    expect(randomSuffix()).toMatch(/^[a-z]{3}$/);
  });

  it('skips a name that already exists', () => {
    const name = cloneName('test', new Set(['test_aaa']), letters('aaabbb'));
    expect(name).toBe('test_bbb');
  });

  it('makes every name in a batch unique', () => {
    const names = cloneNames('test', 5, new Set(), letters('aaaaaabbbcccdddeee'));
    expect(new Set(names).size).toBe(5);
    for (const n of names) expect(n).toMatch(/^test_[a-z]{3}$/);
  });

  it('stays within Meta’s 512-character limit', () => {
    expect(cloneName('x'.repeat(600), new Set()).length).toBe(512);
  });
});
