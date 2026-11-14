import { afterEach, describe, expect, it, vi } from 'vitest';

import { isPlatformAdmin } from './platform-admin';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isPlatformAdmin', () => {
  it('recognizes the configured email list case-insensitively', () => {
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'admin@example.com, second@example.com ');

    expect(isPlatformAdmin('ADMIN@example.com', 'user')).toBe(true);
    expect(isPlatformAdmin('second@example.com', 'user')).toBe(true);
    expect(isPlatformAdmin('not-admin@example.com', 'user')).toBe(false);
  });

  it('recognizes the superadmin profile role and denies unlisted users', () => {
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', '');

    expect(isPlatformAdmin('user@example.com', 'superadmin')).toBe(true);
    expect(isPlatformAdmin(undefined, null)).toBe(false);
  });
});
