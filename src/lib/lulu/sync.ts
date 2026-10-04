import { normalizeMobile } from "./phone";
import { lifecycleStage } from "./lifecycle";
import type { CustomerProfile, LifecycleStage } from "./types";

/** Max customers per sync request (keeps well inside the 120 req/min key limit). */
export const MAX_SYNC_BATCH = 500;

export interface SyncRowError {
  index: number;
  customer_id: string | null;
  error: string;
}

export interface ProfileRow {
  customer_id: string;
  loyalty_id: string | null;
  mobile: string;
  name: string | null;
  language: string;
  birthday: string | null;
  first_order_date: string | null;
  last_order_date: string | null;
  total_orders: number;
  total_sales: number;
  average_order_value: number;
  orders_30d: number;
  orders_90d: number;
  median_interval_days: number | null;
  stddev_interval_days: number | null;
  preferred_store: string | null;
  preferred_category: string | null;
  customer_segment: string | null;
  lifecycle_stage: LifecycleStage;
  rfm_recency: number | null;
  rfm_frequency: number | null;
  rfm_monetary: number | null;
  lifetime_value: number;
  vip_flag: boolean;
  marketing_opt_in: boolean;
  active_complaint: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown, d = 0) => {
  const n = num(v);
  return n === null ? d : Math.max(0, Math.round(n));
};
const date = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m && !Number.isNaN(Date.parse(m[1])) ? m[1] : null;
};
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : v === "true" || v === 1 ? true : v === "false" || v === 0 ? false : d);
const small = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.min(5, Math.max(1, Math.round(n)));
};

/**
 * Validate one inbound customer (snake_case JSON from BigQuery/n8n) and
 * derive the profile row. `lifecycle_stage` is computed by our engine
 * unless the caller supplies a valid one. Returns a row or an error string.
 */
export function parseCustomer(raw: unknown, now: Date): ProfileRow | string {
  if (!raw || typeof raw !== "object") return "row must be an object";
  const r = raw as Record<string, unknown>;

  const customerId = str(r.customer_id) ?? (typeof r.customer_id === "number" ? String(r.customer_id) : null);
  if (!customerId) return "customer_id is required";
  const mobile = normalizeMobile(str(r.mobile));
  if (!mobile) return "mobile is missing or not a valid phone number";

  const lang = (str(r.language) ?? "ar").toLowerCase().slice(0, 5);
  const totalOrders = int(r.total_orders);
  const totalSales = num(r.total_sales) ?? 0;
  const aov = num(r.average_order_value) ?? (totalOrders > 0 ? Math.round((totalSales / totalOrders) * 100) / 100 : 0);

  const row: ProfileRow = {
    customer_id: customerId,
    loyalty_id: str(r.loyalty_id),
    mobile,
    name: str(r.name),
    language: lang,
    birthday: date(r.birthday),
    first_order_date: date(r.first_order_date),
    last_order_date: date(r.last_order_date),
    total_orders: totalOrders,
    total_sales: totalSales,
    average_order_value: aov,
    orders_30d: int(r.orders_30d),
    orders_90d: int(r.orders_90d),
    median_interval_days: num(r.median_interval_days),
    stddev_interval_days: num(r.stddev_interval_days),
    preferred_store: str(r.preferred_store),
    preferred_category: str(r.preferred_category),
    customer_segment: str(r.customer_segment),
    lifecycle_stage: "NEW",
    rfm_recency: small(r.rfm_recency),
    rfm_frequency: small(r.rfm_frequency),
    rfm_monetary: small(r.rfm_monetary),
    lifetime_value: num(r.lifetime_value) ?? totalSales,
    vip_flag: bool(r.vip_flag, false),
    marketing_opt_in: bool(r.marketing_opt_in, true),
    active_complaint: bool(r.active_complaint, false),
  };

  const asProfile: CustomerProfile = {
    customerId,
    mobile,
    name: row.name,
    language: row.language,
    birthday: row.birthday,
    lastOrderDate: row.last_order_date,
    totalOrders: row.total_orders,
    totalSales: row.total_sales,
    medianIntervalDays: row.median_interval_days,
    vipFlag: row.vip_flag,
    marketingOptIn: row.marketing_opt_in,
    activeComplaint: row.active_complaint,
    preferredStore: row.preferred_store,
  };
  row.lifecycle_stage = lifecycleStage(asProfile, now);
  return row;
}
