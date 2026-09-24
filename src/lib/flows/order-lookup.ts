/**
 * Order lookup against the production biodata orders Postgres database.
 *
 * Ported from the legacy PHP bot's src/Db.php search_by_mobile_pg() —
 * same query, same "-1 month" expiry rule, so this flow's answer always
 * matches what the download page itself would tell the customer.
 *
 * Used exclusively by the `http_fetch` node type in engine.ts, wired
 * specifically for the "Biodata Support Bot" flow's mobile-number step.
 * Not a general-purpose HTTP node — see ORDER_LOOKUP_NODE_TYPE below.
 */

import { withOrdersClient } from "@/lib/orders/pg";

function normalizeMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  return digits.slice(-10);
}

export type OrderLookupResult =
  | { status: "not_found" }
  | { status: "active"; paymentId: string }
  | { status: "expired"; paymentId: string };

/**
 * Looks up the most recent order for a mobile number. Any DB/config
 * error is treated as "not_found" — the flow falls through to the
 * handoff branch rather than crashing the run.
 */
export async function lookupOrderByMobile(
  mobile: string,
): Promise<OrderLookupResult> {
  const key = normalizeMobile(mobile);
  if (key.length < 10) return { status: "not_found" };

  try {
    const { rows } = await withOrdersClient((client) =>
      client.query<{ transaction_id: string; created_on: string }>(
        `SELECT transaction_id, created_on
         FROM api.biodata_purchases
         WHERE right(regexp_replace(mobile, '\\D', '', 'g'), 10) = $1
         ORDER BY created_on DESC
         LIMIT 1`,
        [key],
      ),
    );
    const order = rows[0];
    if (!order) return { status: "not_found" };

    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const expired = new Date(order.created_on) < oneMonthAgo;

    return {
      status: expired ? "expired" : "active",
      paymentId: order.transaction_id,
    };
  } catch (err) {
    console.error(
      "[order-lookup] query failed:",
      err instanceof Error ? err.message : err,
    );
    return { status: "not_found" };
  }
}

/**
 * The DB's flow_nodes.node_type CHECK constraint already reserves
 * 'http_fetch' as a v2 node type (see 010_flows.sql). We repurpose that
 * exact string for this bespoke order-lookup node rather than adding a
 * migration — it's the only node using it today.
 */
export const ORDER_LOOKUP_NODE_TYPE = "http_fetch";

export interface OrderLookupNodeConfig {
  /** run.vars key holding the mobile number to look up. */
  mobile_var: string;
  active_next: string;
  expired_next: string;
  not_found_next: string;
}
