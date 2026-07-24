import { describe, expect, it } from 'vitest';

import { pageTitles } from './header';
import { bottomNavItems, sidebarNavItems } from './sidebar';

describe('header navigation contract', () => {
  it('maps every sidebar route to a header title', () => {
    const hrefs = [...sidebarNavItems, ...bottomNavItems].map(
      (item) => item.href
    );

    expect(Object.keys(pageTitles)).toEqual(expect.arrayContaining(hrefs));
  });
});
