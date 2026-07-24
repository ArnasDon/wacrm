import { describe, expect, it } from 'vitest';

import {
  BROADCAST_TEMPLATE_RETURN_TO,
  buildBroadcastTemplateReturnHref,
  getAllowedBroadcastReturnTo,
  isExactAction,
  OPERATIONAL_ACTION_HREFS,
  removeActionFromHref,
} from './operational-navigation';

describe('operational action links', () => {
  it('keeps the dashboard action contracts exact', () => {
    expect(OPERATIONAL_ACTION_HREFS).toEqual({
      newContact: '/contacts?action=new',
      newDeal: '/pipelines?action=new-deal',
      newTemplateForBroadcast:
        '/settings?tab=templates&action=new&returnTo=/broadcasts/new',
    });
  });

  it('only opens forms for exact action values', () => {
    expect(isExactAction('new', 'new')).toBe(true);
    expect(isExactAction('new-deal', 'new-deal')).toBe(true);
    expect(isExactAction('new-contact', 'new')).toBe(false);
    expect(isExactAction('new-deal-extra', 'new-deal')).toBe(false);
    expect(isExactAction(null, 'new')).toBe(false);
  });
});

describe('removeActionFromHref', () => {
  it('removes only action and preserves all other parameters', () => {
    const params = new URLSearchParams(
      'tab=templates&action=new&returnTo=%2Fbroadcasts%2Fnew&filter=open'
    );

    expect(removeActionFromHref('/settings', params)).toBe(
      '/settings?tab=templates&returnTo=%2Fbroadcasts%2Fnew&filter=open'
    );
  });

  it('returns the bare pathname when action was the only parameter', () => {
    expect(
      removeActionFromHref('/contacts', new URLSearchParams('action=new'))
    ).toBe('/contacts');
  });
});

describe('broadcast template return allowlist', () => {
  it('accepts only the exact campaign creation path', () => {
    expect(getAllowedBroadcastReturnTo(BROADCAST_TEMPLATE_RETURN_TO)).toBe(
      BROADCAST_TEMPLATE_RETURN_TO
    );
    expect(getAllowedBroadcastReturnTo('/broadcasts')).toBeNull();
    expect(getAllowedBroadcastReturnTo('/broadcasts/new/anything')).toBeNull();
    expect(
      getAllowedBroadcastReturnTo('/broadcasts/new?next=/settings')
    ).toBeNull();
    expect(getAllowedBroadcastReturnTo('//evil.example')).toBeNull();
  });

  it('adds a controlled pending marker without trusting returnTo', () => {
    expect(buildBroadcastTemplateReturnHref('/broadcasts/new', 'PENDING')).toBe(
      '/broadcasts/new?templateStatus=pending'
    );
    expect(
      buildBroadcastTemplateReturnHref('/broadcasts/new', 'APPROVED')
    ).toBe('/broadcasts/new');
    expect(
      buildBroadcastTemplateReturnHref('//evil.example', 'PENDING')
    ).toBeNull();
  });
});
