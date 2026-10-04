import { describe, expect, it } from "vitest";
import { normalizeMobile, parseCustomer } from "./index";

const NOW = new Date("2026-09-24T12:00:00Z");

describe("normalizeMobile", () => {
  it.each([
    ["0500000000", "+966500000000"],
    ["500000000", "+966500000000"],
    ["966500000000", "+966500000000"],
    ["+966 50 000 0000", "+966500000000"],
    ["00966500000000", "+966500000000"],
    ["+14155550123", "+14155550123"],
    ["971501234567", "+971501234567"], // UAE, 12 digits (seen in the data)
    ["97333123456", "+97333123456"], // Bahrain, 11 digits
  ])("%s -> %s", (input, out) => expect(normalizeMobile(input)).toBe(out));
  it("rejects junk", () => {
    expect(normalizeMobile("")).toBeNull();
    expect(normalizeMobile("abc")).toBeNull();
    expect(normalizeMobile("123")).toBeNull();
  });
});

describe("parseCustomer", () => {
  it("requires customer_id and a valid mobile", () => {
    expect(parseCustomer({ mobile: "0500000000" }, NOW)).toMatch(/customer_id/);
    expect(parseCustomer({ customer_id: "1", mobile: "x" }, NOW)).toMatch(/mobile/);
    expect(parseCustomer(null, NOW)).toMatch(/object/);
  });
  it("derives AOV, lifecycle stage and defaults", () => {
    const r = parseCustomer(
      { customer_id: 12345, mobile: "0500000000", total_orders: 38, total_sales: 5244,
        last_order_date: "2026-09-05T00:00:00Z", median_interval_days: 7, vip_flag: "true" },
      NOW,
    );
    expect(typeof r).toBe("object");
    if (typeof r === "string") return;
    expect(r.customer_id).toBe("12345");
    expect(r.mobile).toBe("+966500000000");
    expect(r.average_order_value).toBe(138);
    expect(r.lifecycle_stage).toBe("AT_RISK"); // 19 days vs 7-day cycle = 2.7x (< 3x dormant)
    expect(r.language).toBe("ar");
    expect(r.marketing_opt_in).toBe(true);
    expect(r.vip_flag).toBe(true);
    expect(r.suspect_reason).toBeNull();
  });
  it("carries data-quality fields", () => {
    const r = parseCustomer({ customer_id: "9", mobile: "966558052159", distinct_names: 796, distinct_emails: "809", suspect_reason: "many_names:796" }, NOW);
    expect(typeof r).toBe("object");
    if (typeof r === "string") return;
    expect(r.distinct_names).toBe(796);
    expect(r.distinct_emails).toBe(809);
    expect(r.suspect_reason).toBe("many_names:796");
  });
});
