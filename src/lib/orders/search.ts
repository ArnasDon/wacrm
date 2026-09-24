/**
 * Quick lookup against the production biodata orders API (AWS Lambda +
 * DynamoDB — see `aws-biodata-migration`'s GET /order-search) by mobile
 * number, UTR, or payment (transaction) id — backs the inbox's
 * order-search dialog so an agent can pull up a purchase without leaving
 * the CRM. Replaced the legacy PHP-era Postgres `api.biodata_purchases`
 * database this used to query directly.
 */

import { fetchOrderSearch } from "@/lib/orders/api";

export interface OrderSearchResult {
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
 * Universal partial search across transaction id, UTR, and mobile number
 * — so an agent can search with any fragment of a payment id, UTR, or
 * phone number. Any API/network error returns no results rather than
 * throwing, matching the old direct-DB behavior.
 */
export async function searchOrders(query: string): Promise<OrderSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    return await fetchOrderSearch(trimmed);
  } catch (err) {
    console.error(
      "[order-search] request failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
