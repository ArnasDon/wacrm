export const OPERATIONAL_ACTION_HREFS = {
  newContact: '/contacts?action=new',
  newDeal: '/pipelines?action=new-deal',
  newTemplateForBroadcast:
    '/settings?tab=templates&action=new&returnTo=/broadcasts/new',
} as const;

export const BROADCAST_TEMPLATE_RETURN_TO = '/broadcasts/new' as const;

export type BroadcastTemplateReturnTo = typeof BROADCAST_TEMPLATE_RETURN_TO;

export function isExactAction(
  action: string | null,
  expected: 'new' | 'new-deal'
): boolean {
  return action === expected;
}

export function removeActionFromHref(
  pathname: string,
  searchParams: Pick<URLSearchParams, 'toString'>
): string {
  const params = new URLSearchParams(searchParams.toString());
  params.delete('action');
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function getAllowedBroadcastReturnTo(
  returnTo: string | null
): BroadcastTemplateReturnTo | null {
  return returnTo === BROADCAST_TEMPLATE_RETURN_TO
    ? BROADCAST_TEMPLATE_RETURN_TO
    : null;
}

export function buildBroadcastTemplateReturnHref(
  returnTo: string | null,
  templateStatus?: string | null
): string | null {
  const allowedReturnTo = getAllowedBroadcastReturnTo(returnTo);
  if (!allowedReturnTo) return null;

  if (templateStatus?.toUpperCase() === 'PENDING') {
    return `${allowedReturnTo}?templateStatus=pending`;
  }

  return allowedReturnTo;
}
