import { describe, expect, it } from 'vitest';

import nextConfig, { PRIVATE_PAGE_CACHE_CONTROL } from '../next.config';

describe('next protected page cache headers', () => {
  it('marks exact and nested protected CRM pages as private no-store before public cache', async () => {
    const headers = await nextConfig.headers?.();
    const inboxExactIndex = headers?.findIndex((rule) => rule.source === '/inbox') ?? -1;
    const inboxNestedIndex = headers?.findIndex((rule) => rule.source === '/inbox/:path*') ?? -1;
    const publicRuleIndex = headers?.findIndex((rule) => rule.source.startsWith('/:path((?!')) ?? -1;

    expect(inboxExactIndex).toBeGreaterThanOrEqual(0);
    expect(inboxNestedIndex).toBeGreaterThan(inboxExactIndex);
    expect(publicRuleIndex).toBeGreaterThan(inboxNestedIndex);
    expect(headers?.[inboxExactIndex]?.headers).toContainEqual({
      key: 'Cache-Control',
      value: PRIVATE_PAGE_CACHE_CONTROL,
    });
    expect(headers?.[inboxNestedIndex]?.headers).toContainEqual({
      key: 'Cache-Control',
      value: PRIVATE_PAGE_CACHE_CONTROL,
    });
    expect(headers?.[publicRuleIndex]?.source).toContain('inbox');
  });
});
