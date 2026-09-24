/**
 * Quick lookup against `api.biodata_purchases` by mobile number, UTR,
 * or payment (transaction) id — backs the inbox's order-search dialog
 * so an agent can pull up a purchase without leaving the CRM.
 */

import { withOrdersClient } from "@/lib/orders/pg";

export interface OrderSearchResult {
  id: number;
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

const MAX_RESULTS = 20;

/**
 * Universal partial search across `transaction_id`, `utr_rrn_id`, and
 * `mobile` (case-insensitive substring on the text columns;
 * digits-only substring on mobile so formatting/country-code
 * differences don't matter) — so an agent can search with any
 * fragment of a payment id, UTR, or phone number.
 */
export async function searchOrders(query: string): Promise<OrderSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const digits = trimmed.replace(/\D/g, "");

  interface Row {
    id: number;
    transaction_id: string | null;
    utr_rrn_id: string | null;
    mobile: string | null;
    person_name: string | null;
    email: string | null;
    amount: string | null;
    site: string | null;
    type: string | null;
    template: string | null;
    downloaded: number | null;
    created_on: string;
  }

  try {
    const { rows } = await withOrdersClient((client) =>
      client.query<Row>(
        `SELECT id, transaction_id, utr_rrn_id, mobile, person_name, email,
                amount, site, type, template, downloaded, created_on
         FROM api.biodata_purchases
         WHERE (length($2) >= 4 AND regexp_replace(mobile, '\\D', '', 'g') ILIKE '%' || $2 || '%')
            OR transaction_id ILIKE $1
            OR utr_rrn_id ILIKE $1
         ORDER BY created_on DESC
         LIMIT ${MAX_RESULTS}`,
        [`%${trimmed}%`, digits],
      ),
    );

    return rows.map((r) => ({
      id: r.id,
      transactionId: r.transaction_id,
      utr: r.utr_rrn_id,
      mobile: r.mobile,
      personName: r.person_name,
      email: r.email,
      amount: r.amount,
      site: r.site,
      type: r.type,
      template: r.template,
      downloaded: r.downloaded ?? 0,
      createdOn: r.created_on,
    }));
  } catch (err) {
    console.error(
      "[order-search] query failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
