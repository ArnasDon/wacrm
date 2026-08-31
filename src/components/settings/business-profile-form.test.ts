import { describe, expect, it } from 'vitest';
import { SECTION_META, SETTINGS_SECTIONS } from './settings-sections';

describe('Business Profile branding settings configuration', () => {
  it('includes business section in SETTINGS_SECTIONS', () => {
    expect(SETTINGS_SECTIONS).toContain('business');
  });

  it('configures business section with minRole admin and workspace group', () => {
    const meta = SECTION_META['business'];
    expect(meta).toBeDefined();
    expect(meta.group).toBe('workspace');
    expect(meta.minRole).toBe('admin');
  });
});
