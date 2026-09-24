/**
 * Order lookup against the production biodata orders API (AWS Lambda +
 * DynamoDB — see `aws-biodata-migration`'s GET /order-lookup), which
 * replaced the legacy PHP-era Postgres `api.biodata_purchases` database
 * this used to query directly.
 *
 * Used exclusively by the `http_fetch` node type in engine.ts, wired
 * specifically for the "Biodata Support Bot" flow's mobile-number step.
 * Not a general-purpose HTTP node — see ORDER_LOOKUP_NODE_TYPE below.
 */

import { fetchOrderLookup } from "@/lib/orders/api";

export type OrderLookupResult =
  | { status: "not_found" }
  | { status: "active"; paymentId: string }
  | { status: "expired"; paymentId: string };

/**
 * Looks up the most recent order for a mobile number. Any API/network
 * error is treated as "not_found" — the flow falls through to the
 * handoff branch rather than crashing the run.
 */
export async function lookupOrderByMobile(
  mobile: string,
): Promise<OrderLookupResult> {
  try {
    const result = await fetchOrderLookup(mobile);
    if (result.status !== "active" && result.status !== "expired") {
      return { status: "not_found" };
    }
    if (!result.paymentId) return { status: "not_found" };
    return { status: result.status, paymentId: result.paymentId };
  } catch (err) {
    console.error(
      "[order-lookup] request failed:",
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
