/**
 * Client for the production biodata orders API (AWS Lambda + DynamoDB,
 * see `aws-biodata-migration`) - replaces the direct Postgres connection
 * this project used to make to the legacy PHP-era `api.biodata_purchases`
 * database (see git history for `lib/orders/pg.ts` if you need the old
 * query shapes for reference).
 *
 * Used by the flow engine's mobile-lookup node (`order-lookup.ts`) and the
 * inbox's order-search dialog (`search.ts`).
 */

const DEFAULT_BASE_URL = "https://api.marriagebiodata.site";

function baseUrl(): string {
  return process.env.ORDERS_API_URL ?? DEFAULT_BASE_URL;
}

export interface OrderLookupResponse {
  success: boolean;
  status: "active" | "expired" | "not_found";
  paymentId?: string;
}

/**
 * GET /order-lookup?mobile= - public endpoint, no auth (same trust model
 * as the AWS API's other public routes like /biodata).
 */
export async function fetchOrderLookup(
  mobile: string,
): Promise<OrderLookupResponse> {
  const url = new URL("/order-lookup", baseUrl());
  url.searchParams.set("mobile", mobile);

  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`order-lookup request failed: ${res.status}`);
  }
  return (await res.json()) as OrderLookupResponse;
}

export interface OrderSearchApiResult {
  transactionId: string | null;
  utr: string | null;
  mobile: string | null;
  personName: string | null;
  email: string | null;
  amount: string | null;
  site: string | null;
  type: string | null;
  template: string | null;
  downloaded: number;
  createdOn: string;
}

/**
 * GET /order-search?q= - internal-only, gated by a shared `x-internal-key`
 * header (ORDERS_API_KEY) since it Scans the purchases table, unlike the
 * cheap indexed /order-lookup.
 */
export async function fetchOrderSearch(
  query: string,
): Promise<OrderSearchApiResult[]> {
  const apiKey = process.env.ORDERS_API_KEY;
  if (!apiKey) {
    console.error("[orders-api] ORDERS_API_KEY is not set - order search is disabled");
    return [];
  }

  const url = new URL("/order-search", baseUrl());
  url.searchParams.set("q", query);

  const res = await fetch(url, {
    headers: { "x-internal-key": apiKey },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`order-search request failed: ${res.status}`);
  }
  const body = (await res.json()) as { success: boolean; results: OrderSearchApiResult[] };
  return body.results;
}
