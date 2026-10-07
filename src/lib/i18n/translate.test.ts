import { describe, expect, it } from 'vitest';
import { getT } from './translate';

describe('getT', () => {
  it('reads the English catalogue by default', () => {
    const t = getT('Sidebar');
    expect(t('pipelines')).toBe('Pipelines');
  });
});
