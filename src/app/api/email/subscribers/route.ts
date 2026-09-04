import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { getSubscribers } from '@/lib/listmonk/client';
import { toListmonkErrorResponse } from '@/lib/listmonk/route-helpers';

/**
 * GET /api/email/subscribers?page=&list_id=&search=
 *
 * `search` is a plain substring the user typed. It is NOT passed
 * through to listmonk's `query` parameter verbatim — that parameter
 * is raw SQL spliced into a WHERE clause, so a user-supplied string
 * reaching it would be an injection straight into listmonk's
 * database. We escape quotes and build the expression ourselves.
 */
export async function GET(request: Request) {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const listId = url.searchParams.get('list_id');
  const search = (url.searchParams.get('search') ?? '').trim();

  let query: string | undefined;
  if (search) {
    // Single quotes are the only metacharacter that can break out of
    // the string literal; doubling them is the standard SQL escape.
    // Backslashes are stripped rather than escaped because listmonk's
    // Postgres may or may not have standard_conforming_strings on.
    const safe = search.replace(/\\/g, '').replace(/'/g, "''");
    query = `(subscribers.email ILIKE '%${safe}%' OR subscribers.name ILIKE '%${safe}%')`;
  }

  try {
    const result = await getSubscribers({
      page: Number.isInteger(page) && page > 0 ? page : 1,
      per_page: 50,
      list_id: listId ? Number(listId) || undefined : undefined,
      query,
    });
    return NextResponse.json({
      subscribers: result.results,
      total: result.total,
      page: result.page,
      per_page: result.per_page,
    });
  } catch (err) {
    return toListmonkErrorResponse(err);
  }
}
