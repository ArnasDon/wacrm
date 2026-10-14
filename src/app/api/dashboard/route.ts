import { accountRoute, RequestError } from '@/lib/api/local-route';
import {
  dashboardMetrics,
  dashboardMessages,
  dashboardPipeline,
  dashboardActivity,
} from '@/lib/db/dashboard';
function date(value: string | null): string {
  const time = value ? Date.parse(value) : NaN;
  if (
    !Number.isFinite(time) ||
    time < Date.now() - 100 * 86400000 ||
    time > Date.now() + 86400000
  )
    throw new RequestError('Invalid dashboard date range.');
  return new Date(time).toISOString();
}
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const query = new URL(request.url).searchParams;
    switch (query.get('section')) {
      case 'metrics':
        return dashboardMetrics(
          db,
          ctx.accountId,
          date(query.get('today')),
          date(query.get('yesterday'))
        );
      case 'messages':
        return {
          messages: await dashboardMessages(
            db,
            ctx.accountId,
            date(query.get('start'))
          ),
        };
      case 'pipeline':
        return dashboardPipeline(db, ctx.accountId);
      case 'activity':
        return dashboardActivity(db, ctx.accountId);
      default:
        throw new RequestError('Unknown dashboard section.');
    }
  });
}
